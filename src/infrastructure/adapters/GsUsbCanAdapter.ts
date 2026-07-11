import { CanBusState } from '../../core/enums/CanBusState';
import type { ICanBusAdapter } from '../../core/interfaces/bus/ICanBusAdapter';
import type { CanChannel } from '../../core/models/bus/CanChannel';
import { CanFrame } from '../../core/models/bus/CanFrame';
import type { Disposable } from '../../core/types';
import { ConnectionError } from '../../shared/errors/ConnectionError';
import { Logger } from '../../shared/utils/Logger';
// @ts-ignore - usb package types are incomplete
import USB, { Device } from 'usb';
import {
    GS_USB_VID,
    GS_USB_PID,
    GS_USB_IN_EP_ADDR,
    GS_USB_OUT1_EP_ADDR,
    GS_USB_OUT2_EP_ADDR,
    GS_USB_REQUEST_HOST_FORMAT,
    GS_USB_REQUEST_BITTIMING,
    GS_USB_REQUEST_DATA_BITTIMING,
    GS_USB_REQUEST_MODE,
    GS_USB_REQUEST_BT_CONST,
    GS_USB_REQUEST_BT_CONST_EXT,
    GS_USB_REQUEST_SET_TERMINATION,
    GS_USB_REQUEST_GET_TERMINATION,
    GS_USB_REQUEST_GET_STATE,
    GS_USB_REQUEST_DEVICE_CONFIG,
    GS_USB_CHANNEL_MODE_START,
    GS_USB_CHANNEL_MODE_RESET,
    GS_USB_HOST_FORMAT_LITTLE_ENDIAN,
    GS_USB_CAN_FLAG_FD,
    GS_USB_CAN_FLAG_BRS,
    GS_USB_CAN_FLAG_ESI,
    GS_USB_MAX_DATA_LEN,
    GS_USB_HOST_FRAME_HDR_SIZE,
    GsUsbChannelMode,
    GsUsbChannelState,
    GsUsbDeviceConfig,
    GsUsbBtConst,
    GsUsbBtConstExt,
    GsUsbBittiming,
    GsUsbDeviceMode,
    GsUsbDeviceState,
    GsUsbTerminationState,
    GsUsbHostFrameHeader,
} from './GsUsbConstants';
import {
    encodeGsUsbFrame,
    decodeGsUsbFrames,
    buildBittimingPayload,
    buildDataBittimingPayload,
    buildModePayload,
    buildTerminationPayload,
    buildHostFormatPayload,
    parseDeviceConfig,
    parseBtConst,
    parseBtConstExt,
    parseChannelState,
    parseTerminationState,
} from './GsUsbFrame';
import type { CanId } from '../../core/types';

/**
 * gs_usb (CANnectivity) CAN bus adapter
 * Implements the Geschwister Schneider USB/CAN protocol over USB bulk endpoints
 */
export class GsUsbCanAdapter implements ICanBusAdapter {
    private _state: CanBusState = CanBusState.Disconnected;
    private device: Device | null = null;
    private interfaceNumber = 0;
    private channel = 0;
    private echoIdCounter = 0;
    private readLoopActive = false;
    private frameCallbacks = new Set<(frame: CanFrame) => void>();
    private stateCallbacks = new Set<(state: CanBusState) => void>();
    private errorCallbacks = new Set<(error: Error) => void>();
    private btConst: GsUsbBtConst | null = null;
    private btConstExt: GsUsbBtConstExt | null = null;
    private deviceConfig: GsUsbDeviceConfig | null = null;

    get state(): CanBusState {
        return this._state;
    }

    async connect(channel: CanChannel): Promise<void> {
        if (this._state !== CanBusState.Disconnected) {
            throw new ConnectionError('Already connected or connecting', 'gs_usb');
        }

        this.channel = channel.adapterType === 'gs_usb' ? (channel as any).channelIndex ?? 0 : 0;
        this.setState(CanBusState.Connecting);
        Logger.info(`gs_usb: connecting to CANnectivity device (channel ${this.channel})`);

        try {
            // Find and open USB device
            await this.openUsbDevice();

            // Configure device
            await this.configureDevice(channel.bitrate, channel.dataBitrate);

            // Start read loop
            this.startReadLoop();

            this.setState(CanBusState.Connected);
            Logger.info(`gs_usb: connected to CANnectivity device`);
        } catch (err) {
            this.setState(CanBusState.Error);
            await this.cleanup();
            throw err;
        }
    }

    private async openUsbDevice(): Promise<void> {
        // Find CANnectivity device by VID/PID
        const devices = USB.getDeviceList();
        const targetDevice = devices.find(
            (d) => d.deviceDescriptor.idVendor === GS_USB_VID && d.deviceDescriptor.idProduct === GS_USB_PID
        );

        if (!targetDevice) {
            throw new ConnectionError(
                `CANnectivity device not found (VID: 0x${GS_USB_VID.toString(16)}, PID: 0x${GS_USB_PID.toString(16)})`,
                'gs_usb'
            );
        }

        this.device = targetDevice;
        await this.device.open();

        // Reset device
        await this.device.reset();

        // Set configuration (usually 1)
        await this.device.setConfiguration(1);

        // Claim interface 0 (gs_usb interface)
        await this.device.claimInterface(this.interfaceNumber);

        Logger.info('gs_usb: USB device opened and interface claimed');
    }

    private async configureDevice(bitrate: number, dataBitrate?: number): Promise<void> {
        if (!this.device) throw new ConnectionError('Device not opened', 'gs_usb');

        // 1. Set host format (little-endian)
        await this.controlTransferOut(GS_USB_REQUEST_HOST_FORMAT, buildHostFormatPayload(true));

        // 2. Get device config
        const configData = await this.controlTransferIn(GS_USB_REQUEST_DEVICE_CONFIG, 64);
        this.deviceConfig = parseDeviceConfig(configData);
        if (!this.deviceConfig) {
            throw new ConnectionError('Failed to parse device config', 'gs_usb');
        }
        Logger.info(`gs_usb: Device config - channels: ${this.deviceConfig.nchannels}, SW: ${this.deviceConfig.swVersion}, HW: ${this.deviceConfig.hwVersion}`);

        // 3. Get bit timing constants (classic CAN)
        const btConstData = await this.controlTransferIn(GS_USB_REQUEST_BT_CONST, 36);
        this.btConst = parseBtConst(btConstData);
        if (this.btConst) {
            Logger.info(`gs_usb: Classic CAN timing limits - fclk: ${this.btConst.fclkCan}Hz, BRP: ${this.btConst.brpMin}-${this.btConst.brpMax}`);
        }

        // 4. Get extended bit timing constants (CAN FD)
        const btConstExtData = await this.controlTransferIn(GS_USB_REQUEST_BT_CONST_EXT, 68);
        this.btConstExt = parseBtConstExt(btConstExtData);
        if (this.btConstExt) {
            Logger.info(`gs_usb: CAN FD timing limits available`);
        }

        // 5. Calculate and set classic CAN bit timing
        const classicBittiming = this.calculateBittiming(bitrate, false);
        await this.controlTransferOut(GS_USB_REQUEST_BITTIMING, buildBittimingPayload(
            classicBittiming.propSeg,
            classicBittiming.phaseSeg1,
            classicBittiming.phaseSeg2,
            classicBittiming.sjw,
            classicBittiming.brp
        ), this.channel);

        // 6. Set CAN FD data bit timing if dataBitrate provided
        if (dataBitrate && ((this.btConstExt?.feature ?? 0) & 0x100)) { // FD feature supported
            const fdBittiming = this.calculateBittiming(dataBitrate, true);
            await this.controlTransferOut(GS_USB_REQUEST_DATA_BITTIMING, buildDataBittimingPayload(
                fdBittiming.propSeg,
                fdBittiming.phaseSeg1,
                fdBittiming.phaseSeg2,
                fdBittiming.sjw,
                fdBittiming.brp
            ), this.channel);
        }

        // 7. Start channel
        await this.controlTransferOut(GS_USB_REQUEST_MODE, buildModePayload(
            GS_USB_CHANNEL_MODE_START,
            0 // flags
        ), this.channel);

        // 8. Enable termination (optional, default on)
        await this.controlTransferOut(GS_USB_REQUEST_SET_TERMINATION, buildTerminationPayload(1), this.channel);
    }

    private calculateBittiming(bitrate: number, isFd: boolean): GsUsbBittiming {
        // Simple bit timing calculation - in production, use proper algorithm
        // This is a simplified version - real implementation should use proper CAN bit timing calculation
        const btConst = isFd ? this.btConstExt : this.btConst;
        if (!btConst) {
            // Fallback defaults for 500kbps
            return {
                propSeg: 63,
                phaseSeg1: 86,
                phaseSeg2: 16,
                sjw: 16,
                brp: 2,
            };
        }

        // Simplified calculation - real implementation should use proper algorithm
        const fclk = btConst.fclkCan;
        const targetBitrate = bitrate;
        const brp = Math.max(btConst.brpMin, Math.min(btConst.brpMax, Math.floor(fclk / (targetBitrate * 20))));
        const tq = fclk / brp;
        const totalTq = tq / targetBitrate;

        // Distribute time quanta (simplified)
        const propSeg = Math.min(63, Math.max(1, Math.floor(totalTq * 0.3)));
        const phaseSeg1 = Math.min(255, Math.max(1, Math.floor(totalTq * 0.4)));
        const phaseSeg2 = Math.max(1, Math.floor(totalTq * 0.3));
        const sjw = Math.min(128, Math.max(1, Math.floor(totalTq * 0.1)));

        return {
            propSeg,
            phaseSeg1,
            phaseSeg2,
            sjw,
            brp,
        };
    }

    private async controlTransferOut(request: number, data: Buffer, channel = 0): Promise<void> {
        if (!this.device) throw new ConnectionError('Device not opened', 'gs_usb');

        return new Promise((resolve, reject) => {
            this.device!.controlTransfer(
                {
                    bmRequestType: 0x40, // Vendor, OUT, Interface
                    bRequest: request,
                    wValue: channel,
                    wIndex: this.interfaceNumber,
                },
                data,
                (err: Error | null) => {
                    if (err) {
                        reject(new ConnectionError(`Control transfer OUT failed: ${err.message}`, 'gs_usb'));
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    private async controlTransferIn(request: number, length: number, channel = 0): Promise<Buffer> {
        if (!this.device) throw new ConnectionError('Device not opened', 'gs_usb');

        return new Promise((resolve, reject) => {
            this.device!.controlTransfer(
                {
                    bmRequestType: 0xC0, // Vendor, IN, Interface
                    bRequest: request,
                    wValue: channel,
                    wIndex: this.interfaceNumber,
                },
                length,
                (err: Error | null, data: Buffer) => {
                    if (err) {
                        reject(new ConnectionError(`Control transfer IN failed: ${err.message}`, 'gs_usb'));
                    } else {
                        resolve(data);
                    }
                }
            );
        });
    }

    private startReadLoop(): void {
        if (!this.device || this.readLoopActive) return;

        this.readLoopActive = true;
        this.readLoop();
    }

    private async readLoop(): Promise<void> {
        while (this.readLoopActive && this.device) {
            try {
                // Read from bulk IN endpoint
                const data = await this.bulkTransferIn(GS_USB_IN_EP_ADDR, 512);
                if (data && data.length > 0) {
                    const frames = decodeGsUsbFrames(data, this.channel);
                    for (const frame of frames) {
                        for (const cb of this.frameCallbacks) {
                            cb(frame);
                        }
                    }
                }
            } catch (err) {
                if (this.readLoopActive) {
                    Logger.error(`gs_usb: Read error: ${err}`);
                    for (const cb of this.errorCallbacks) {
                        cb(err as Error);
                    }
                }
                break;
            }
        }
    }

    private async bulkTransferIn(endpoint: number, length: number): Promise<Buffer> {
        if (!this.device) throw new ConnectionError('Device not opened', 'gs_usb');

        return new Promise((resolve, reject) => {
            this.device!.transferIn(endpoint, length, (err: Error | null, data: Buffer) => {
                if (err) {
                    reject(new ConnectionError(`Bulk transfer IN failed: ${err.message}`, 'gs_usb'));
                } else {
                    resolve(data);
                }
            });
        });
    }

    private async bulkTransferOut(endpoint: number, data: Buffer): Promise<void> {
        if (!this.device) throw new ConnectionError('Device not opened', 'gs_usb');

        return new Promise((resolve, reject) => {
            this.device!.transferOut(endpoint, data, (err: Error | null) => {
                if (err) {
                    reject(new ConnectionError(`Bulk transfer OUT failed: ${err.message}`, 'gs_usb'));
                } else {
                    resolve();
                }
            });
        });
    }

    async disconnect(): Promise<void> {
        Logger.info('gs_usb: disconnecting');
        this.readLoopActive = false;

        // Stop channel
        if (this.device) {
            try {
                await this.controlTransferOut(GS_USB_REQUEST_MODE, buildModePayload(
                    GS_USB_CHANNEL_MODE_RESET,
                    0
                ), this.channel);
            } catch {
                // Ignore errors during cleanup
            }
        }

        await this.cleanup();
        this.setState(CanBusState.Disconnected);
    }

    private async cleanup(): Promise<void> {
        if (this.device) {
            try {
                await this.device.releaseInterface(this.interfaceNumber);
                await this.device.close();
            } catch {
                // Ignore cleanup errors
            }
            this.device = null;
        }
    }

    async send(frame: CanFrame): Promise<void> {
        if (this._state !== CanBusState.Connected || !this.device) {
            throw new ConnectionError('Cannot send: not connected', 'gs_usb');
        }

        const echoId = ++this.echoIdCounter;
        const data = encodeGsUsbFrame(frame, this.channel, echoId);

        await this.bulkTransferOut(GS_USB_OUT1_EP_ADDR, data);
    }

    onFrameReceived(callback: (frame: CanFrame) => void): Disposable {
        this.frameCallbacks.add(callback);
        return { dispose: () => this.frameCallbacks.delete(callback) };
    }

    onStateChanged(callback: (state: CanBusState) => void): Disposable {
        this.stateCallbacks.add(callback);
        return { dispose: () => this.stateCallbacks.delete(callback) };
    }

    onError(callback: (error: Error) => void): Disposable {
        this.errorCallbacks.add(callback);
        return { dispose: () => this.errorCallbacks.delete(callback) };
    }

    private setState(newState: CanBusState): void {
        this._state = newState;
        for (const cb of this.stateCallbacks) {
            cb(newState);
        }
    }
}