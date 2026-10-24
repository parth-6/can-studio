import { AdapterType } from '../../core/enums/AdapterType';
import type { ICanBusAdapter } from '../../core/interfaces/bus/ICanBusAdapter';
import { SocketCanAdapter } from './SocketCanAdapter';
import { VirtualCanAdapter } from './VirtualCanAdapter';
import { Logger } from '../../shared/utils/Logger';

/**
 * Factory for creating CAN bus adapter instances based on the configured type.
 * Follows the same Open/Closed pattern as ParserFactory — new adapters are
 * registered here without touching existing code.
 *
 * Native-addon-backed adapters (SLCAN, GS-USB) are loaded lazily via dynamic
 * import() so that a missing/mismatched native binary only breaks that one
 * adapter type, not the whole extension. Using dynamic import() with static
 * string literals allows webpack to properly analyze the dependencies.
 */
export class AdapterFactory {
    private static readonly registry = new Map<AdapterType, () => Promise<ICanBusAdapter>>([
        [AdapterType.SocketCAN, () => Promise.resolve(new SocketCanAdapter())],
        [AdapterType.Virtual, () => Promise.resolve(new VirtualCanAdapter())],
    ]);

    /** Create a new adapter instance for the given type. */
    static async create(type: AdapterType): Promise<ICanBusAdapter> {
        // Lazily register native-addon-backed adapters on first request so
        // their import() only runs when actually needed.
        if (!AdapterFactory.registry.has(type)) {
            await AdapterFactory.lazyRegisterNative(type);
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
    private static async lazyRegisterNative(type: AdapterType): Promise<void> {
        let factory: (() => Promise<ICanBusAdapter>) | null = null;
        switch (type) {
            case AdapterType.SLCAN: {
                try {
                    // Dynamic import with static string literal - webpack can analyze this
                    const { SLCANCanAdapter } = await import('./SLCANCanAdapter');
                    factory = () => Promise.resolve(new SLCANCanAdapter());
                } catch (err) {
                    Logger.error(
                        `Failed to load SLCAN adapter (native dependency missing or ABI mismatch): ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
                break;
            }
            case AdapterType.GsUsb: {
                try {
                    // Dynamic import with static string literal - webpack can analyze this
                    const { GsUsbCanAdapter } = await import('./GsUsbCanAdapter');
                    factory = () => Promise.resolve(new GsUsbCanAdapter());
                } catch (err) {
                    Logger.error(
                        `Failed to load GS-USB adapter (native dependency missing or ABI mismatch): ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
                break;
            }
            default:
                return;
        }
        if (factory) {
            AdapterFactory.registry.set(type, factory);
        }
    }

    /** Register a custom adapter factory for a given type. */
    static register(type: AdapterType, factory: () => Promise<ICanBusAdapter>): void {
        AdapterFactory.registry.set(type, factory);
    }

    /** Return all currently registered adapter types. */
    static getSupportedTypes(): AdapterType[] {
        return Array.from(AdapterFactory.registry.keys());
    }
}
