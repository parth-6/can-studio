import { AdapterType } from '../../core/enums/AdapterType';
import type { ICanBusAdapter } from '../../core/interfaces/bus/ICanBusAdapter';
import { SocketCanAdapter } from './SocketCanAdapter';
import { VirtualCanAdapter } from './VirtualCanAdapter';
import { Logger } from '../../shared/utils/Logger';

/**
 * Lazily require a native-addon-backed adapter module, returning null and
 * logging a user-facing error if the native dependency fails to load.
 *
 * Native addons (`usb`, `serialport`) are excluded from the webpack bundle and
 * `require()`'d at runtime. If the binary is missing or built against the
 * wrong ABI, `require()` throws — we must not let that propagate and take down
 * extension activation. Instead, surface the error only when the user actually
 * tries to use that adapter type.
 */
function lazyRequireAdapter(
    modulePath: string,
    exportName: string,
    adapterName: string,
): (() => ICanBusAdapter) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(modulePath);
        const AdapterCtor = mod[exportName] as new () => ICanBusAdapter;
        return () => new AdapterCtor();
    } catch (err) {
        Logger.error(
            `Failed to load ${adapterName} adapter (native dependency missing or ABI mismatch): ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return null;
    }
}

/**
 * Factory for creating CAN bus adapter instances based on the configured type.
 * Follows the same Open/Closed pattern as ParserFactory — new adapters are
 * registered here without touching existing code.
 *
 * Adapters backed by native Node addons (`usb`, `serialport`) are loaded
 * lazily via dynamic `require()` so that a missing/mismatched native binary
 * only breaks that one adapter type, not the whole extension.
 */
export class AdapterFactory {
    private static readonly registry = new Map<AdapterType, () => ICanBusAdapter>([
        [AdapterType.SocketCAN, () => new SocketCanAdapter()],
        [AdapterType.Virtual, () => new VirtualCanAdapter()],
    ]);

    /** Create a new adapter instance for the given type. */
    static create(type: AdapterType): ICanBusAdapter {
        // Lazily register native-addon-backed adapters on first request so
        // their `require()` only runs when actually needed.
        if (!AdapterFactory.registry.has(type)) {
            AdapterFactory.lazyRegisterNative(type);
        }
        const factory = AdapterFactory.registry.get(type);
        if (!factory) {
            throw new Error(
                `No adapter registered for type: ${type} (native dependency may have failed to load)`,
            );
        }
        return factory();
    }

    /** Attempt to register a native-addon-backed adapter on demand. */
    private static lazyRegisterNative(type: AdapterType): void {
        let modulePath: string | null = null;
        let exportName: string | null = null;
        let adapterName: string | null = null;
        switch (type) {
            case AdapterType.SLCAN:
                modulePath = './SLCANCanAdapter';
                exportName = 'SLCANCanAdapter';
                adapterName = 'SLCAN';
                break;
            case AdapterType.GsUsb:
                modulePath = './GsUsbCanAdapter';
                exportName = 'GsUsbCanAdapter';
                adapterName = 'GS-USB';
                break;
            default:
                return;
        }
        const factory = lazyRequireAdapter(modulePath, exportName, adapterName);
        if (factory) {
            AdapterFactory.registry.set(type, factory);
        }
    }

    /** Register a custom adapter factory for a given type. */
    static register(type: AdapterType, factory: () => ICanBusAdapter): void {
        AdapterFactory.registry.set(type, factory);
    }

    /** Return all currently registered adapter types. */
    static getSupportedTypes(): AdapterType[] {
        return Array.from(AdapterFactory.registry.keys());
    }
}
