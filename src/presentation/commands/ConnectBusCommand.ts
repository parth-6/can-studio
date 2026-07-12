import * as vscode from 'vscode';
import type { VirtualBusSimulationService } from '../../application/services/VirtualBusSimulationService';
import { AdapterType } from '../../core/enums/AdapterType';
import { CanBusState } from '../../core/enums/CanBusState';
import type { ICanBusAdapter } from '../../core/interfaces/bus/ICanBusAdapter';
import { CanChannel } from '../../core/models/bus/CanChannel';
import { AdapterFactory } from '../../infrastructure/adapters/AdapterFactory';
import { SocketCanAdapter } from '../../infrastructure/adapters/SocketCanAdapter';
import { SLCANCanAdapter } from '../../infrastructure/adapters/SLCANCanAdapter';
import { GsUsbCanAdapter } from '../../infrastructure/adapters/GsUsbCanAdapter';
import { VirtualCanAdapter } from '../../infrastructure/adapters/VirtualCanAdapter';
import { Commands, DEFAULT_BITRATE } from '../../shared/constants';
import type { EventBus } from '../../shared/events/EventBus';
import { Logger } from '../../shared/utils/Logger';
import { messageForUser } from '../../shared/utils/errorUtils';

/**
 * Command to connect to a CAN bus interface.
 * Prompts the user to choose an adapter type and channel name.
 * Forwards adapter state changes to the shared EventBus so other layers
 * (ConnectionStatusBar, WebviewMessageHandler) react without tight coupling.
 */
export class ConnectBusCommand {
    static readonly ID = Commands.CONNECT_BUS;

    private adapter: ICanBusAdapter | null = null;
    private adapterConnectedCallbacks = new Set<(adapter: ICanBusAdapter) => void>();
    private adapterDisconnectedCallbacks = new Set<() => void>();
    private virtualBusSimulation: VirtualBusSimulationService | null = null;

    constructor(private readonly eventBus: EventBus) {}

    getAdapter(): ICanBusAdapter | null {
        return this.adapter;
    }

    /** Used to gate hardware/virtual switches while Signal Lab simulation is active. */
    setVirtualBusSimulationService(service: VirtualBusSimulationService | null): void {
        this.virtualBusSimulation = service;
    }

    /** Register a callback invoked with the new adapter after a successful connection. */
    onAdapterConnected(cb: (adapter: ICanBusAdapter) => void): () => void {
        this.adapterConnectedCallbacks.add(cb);
        return () => this.adapterConnectedCallbacks.delete(cb);
    }

    /** Register a callback invoked when the active adapter disconnects. */
    onAdapterDisconnected(cb: () => void): () => void {
        this.adapterDisconnectedCallbacks.add(cb);
        return () => this.adapterDisconnectedCallbacks.delete(cb);
    }

    private bridgeAdapterLifecycle(adapter: ICanBusAdapter): void {
        adapter.onStateChanged((state) => {
            this.eventBus.emit('bus:stateChanged', state);
            if (state === CanBusState.Disconnected) {
                this.adapter = null;
                for (const cb of this.adapterDisconnectedCallbacks) {
                    cb();
                }
            }
        });
    }

    /**
     * Disconnect without status-bar toasts (e.g. Signal Lab auto teardown after virtual stop).
     */
    async disconnectSilently(): Promise<void> {
        const a = this.adapter;
        if (a) {
            await a.disconnect();
        }
    }

    /**
     * Connect a prepared adapter instance (Signal Lab virtual bus). Replaces any existing connection.
     */
    async connectAdapter(
        adapter: ICanBusAdapter,
        channel: CanChannel,
        options?: { silentToast?: boolean },
    ): Promise<void> {
        try {
            if (this.virtualBusSimulation?.isRunning()) {
                const r = await vscode.window.showWarningMessage(
                    'Virtual bus simulation is running. Stop it before changing the adapter connection.',
                    { modal: true },
                    'Stop simulation',
                );
                if (r !== 'Stop simulation') {
                    throw new Error('CONNECT_CANCELLED');
                }
                this.virtualBusSimulation.stop();
            }

            if (this.adapter && this.adapter !== adapter) {
                await this.adapter.disconnect();
            }

            this.bridgeAdapterLifecycle(adapter);
            /** Set before `connect` so Disconnect / status bar can cancel a stuck "connecting" attempt. */
            this.adapter = adapter;

            await adapter.connect(channel);

            Logger.info(`Connected adapter (${channel.name})`);
            if (!options?.silentToast) {
                vscode.window.showInformationMessage(`Connected to CAN bus: ${channel.name}`);
            }
            for (const cb of this.adapterConnectedCallbacks) {
                cb(adapter);
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.message === 'CONNECT_CANCELLED') {
                throw err;
            }
            Logger.error('connectAdapter failed', err);
            vscode.window.showErrorMessage(`Failed to connect: ${messageForUser(err)}`);
            try {
                await adapter.disconnect();
            } catch {
                /* ignore — still reset UI below */
            }
            this.adapter = null;
            this.eventBus.emit('bus:stateChanged', CanBusState.Disconnected);
            throw err;
        }
    }

    async execute(): Promise<void> {
        const adapterTypes = AdapterFactory.getSupportedTypes();

        const selected = await vscode.window.showQuickPick(
            adapterTypes.map((t) => ({ label: t, adapterType: t as AdapterType })),
            { placeHolder: 'Select CAN adapter type' },
        );

        if (!selected) {
            return;
        }

        const isVirtual = selected.adapterType === AdapterType.Virtual;
        const isSLCAN = selected.adapterType === AdapterType.SLCAN;
        const isGsUsb = selected.adapterType === AdapterType.GsUsb;
        const channelName = await vscode.window.showInputBox({
            prompt: isVirtual
                ? 'Channel label (optional). Virtual mode is in-process software loopback only — no physical adapter or system CAN device.'
                : isSLCAN
                ? 'Enter COM port (e.g. COM3 on Windows, /dev/ttyUSB0 on Linux).'
                : isGsUsb
                ? 'Select CANnectivity device (will auto-detect available devices).'
                : 'Enter SocketCAN interface name (e.g. can0 or vcan0).',
            value: isVirtual ? 'virtual-loopback' : isSLCAN ? 'COM3' : isGsUsb ? 'auto' : 'can0',
        });

        if (!channelName) {
            return;
        }

        // Prompt for arbitration bitrate for hardware adapters (not virtual)
        let bitrate = DEFAULT_BITRATE;
        if (!isVirtual) {
            const bitrateOptions = [
                { label: '10000', description: '10 kbps' },
                { label: '20000', description: '20 kbps' },
                { label: '50000', description: '50 kbps' },
                { label: '100000', description: '100 kbps' },
                { label: '125000', description: '125 kbps' },
                { label: '250000', description: '250 kbps' },
                { label: '500000', description: '500 kbps (default)' },
                { label: '800000', description: '800 kbps' },
                { label: '1000000', description: '1 Mbps' },
            ];
            const bitrateSelection = await vscode.window.showQuickPick(bitrateOptions, {
                placeHolder: 'Select CAN arbitration bitrate (nominal bitrate)',
                title: 'CAN Arbitration Bitrate',
            });
            if (!bitrateSelection) {
                return;
            }
            bitrate = parseInt(bitrateSelection.label, 10);
        }

        let dataBitrate: number | undefined;
        if (!isVirtual) {
            const dataBitrateStr = await vscode.window.showInputBox({
                prompt: 'CAN FD data bitrate in bps (leave empty for classic CAN / no BRS)',
                placeHolder: '2000000',
                validateInput: (v) =>
                    !v || /^\d+$/.test(v) ? null : 'Enter a positive integer or leave empty',
            });
            if (dataBitrateStr === undefined) {
                return;
            }
            dataBitrate = dataBitrateStr ? parseInt(dataBitrateStr, 10) : undefined;
        }

        const existing = this.adapter;
        if (existing) {
            const targetVirtual = selected.adapterType === AdapterType.Virtual;
            const targetSLCAN = selected.adapterType === AdapterType.SLCAN;
            const targetGsUsb = selected.adapterType === AdapterType.GsUsb;
            const targetSocketCAN = selected.adapterType === AdapterType.SocketCAN;
            const existingVirtual = existing instanceof VirtualCanAdapter;
            const existingSLCAN = existing instanceof SLCANCanAdapter;
            const existingGsUsb = existing instanceof GsUsbCanAdapter;
            const existingSocketCAN = existing instanceof SocketCanAdapter;
            
            // Prevent switching between virtual and hardware without explicit confirmation
            if ((existingVirtual && (targetSLCAN || targetGsUsb || targetSocketCAN)) || 
                ((existingSLCAN || existingGsUsb || existingSocketCAN) && targetVirtual)) {
                const r = await vscode.window.showWarningMessage(
                    existingVirtual
                        ? 'Software virtual CAN is connected. Disconnect and connect hardware instead?'
                        : 'Hardware CAN is connected. Disconnect and use virtual (software) instead?',
                    { modal: true },
                    'Disconnect and switch',
                );
                if (r !== 'Disconnect and switch') {
                    return;
                }
                await existing.disconnect();
            }
        }

        try {
            const newAdapter = await AdapterFactory.create(selected.adapterType);
            const channel = new CanChannel({
                name: channelName,
                adapterType: selected.adapterType,
                bitrate,
                dataBitrate,
            });
            await this.connectAdapter(newAdapter, channel, { silentToast: false });
        } catch (err: unknown) {
            if (err instanceof Error && err.message === 'CONNECT_CANCELLED') {
                return;
            }
            throw err;
        }
    }
}
