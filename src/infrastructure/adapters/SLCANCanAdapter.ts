import { CanBusState } from '../../core/enums/CanBusState';
import type { ICanBusAdapter } from '../../core/interfaces/bus/ICanBusAdapter';
import type { CanChannel } from '../../core/models/bus/CanChannel';
import { CanFrame } from '../../core/models/bus/CanFrame';
import type { Disposable } from '../../core/types';
import { ConnectionError } from '../../shared/errors/ConnectionError';
import { Logger } from '../../shared/utils/Logger';
import SerialPort from 'serialport';

/**
 * SLCAN (Serial Line CAN) adapter for USB-to-CAN devices on Windows/Linux.
 * Implements the LAWICEL SLCAN protocol (ASCII-based) used by devices like:
 * - CANable
 * - CANtact
 * - Lawicel CANUSB
 * - Seeed Studio USB-CAN Analyzer
 * - And many other USB-to-CAN adapters
 *
 * Protocol reference: http://www.can232.com/docs/can232_v3.pdf
 */
export class SLCANCanAdapter implements ICanBusAdapter {
    private _state: CanBusState = CanBusState.Disconnected;
    private port: SerialPort | null = null;
    private frameCallbacks = new Set<(frame: CanFrame) => void>();
    private stateCallbacks = new Set<(state: CanBusState) => void>();
    private errorCallbacks = new Set<(error: Error) => void>();
    private readBuffer = '';
    private channel: CanChannel | null = null;

    get state(): CanBusState {
        return this._state;
    }

    async connect(channel: CanChannel): Promise<void> {
        if (this._state !== CanBusState.Disconnected) {
            throw new ConnectionError('Already connected or connecting', 'slcan');
        }

        this.channel = channel;
        this.setState(CanBusState.Connecting);
        Logger.info(`SLCAN: connecting to ${channel.name} at ${channel.bitrate} bps`);

        try {
            // Open serial port
            this.port = new SerialPort(channel.name, {
                baudRate: 115200,   // SLCAN typically uses 115200 baud for the serial link
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                autoOpen: false,
            });

            // Set up event handlers before opening
            this.port.on('data', (data: Buffer) => this.onSerialData(data));
            this.port.on('error', (err: Error) => this.onSerialError(err));
            this.port.on('close', () => this.onSerialClose());

            // Open the port
            await new Promise<void>((resolve, reject) => {
                this.port!.open((err: Error | null | undefined) => {
                    if (err) {
                        reject(new ConnectionError(`Failed to open serial port: ${err.message}`, 'slcan'));
                    } else {
                        resolve();
                    }
                });
            });

            // Initialize SLCAN adapter
            await this.initializeAdapter(channel.bitrate);

            this.setState(CanBusState.Connected);
            Logger.info(`SLCAN: connected to ${channel.name}`);
        } catch (err) {
            this.setState(CanBusState.Error);
            await this.cleanup();
            throw err;
        }
    }

    private async initializeAdapter(bitrate: number): Promise<void> {
        if (!this.port) {
            throw new ConnectionError('Port not initialized', 'slcan');
        }

        // Close any existing CAN channel (send 'C')
        await this.sendCommand('C');

        // Set bitrate (send 'S' + bitrate code)
        const bitrateCode = this.getBitrateCode(bitrate);
        await this.sendCommand(`S${bitrateCode}`);

        // Open CAN channel (send 'O')
        await this.sendCommand('O');

        // Small delay to let adapter settle
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    private getBitrateCode(bitrate: number): string {
        // SLCAN bitrate codes (LAWICEL standard)
        const codes: Record<number, string> = {
            10000: '0',
            20000: '1',
            50000: '2',
            100000: '3',
            125000: '4',
            250000: '5',
            500000: '6',
            800000: '7',
            1000000: '8',
        };
        return codes[bitrate] ?? '6'; // Default to 500kbps
    }

    private sendCommand(cmd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.port || !this.port.isOpen) {
                reject(new ConnectionError('Port not open', 'slcan'));
                return;
            }

            const data = Buffer.from(cmd + '\r');
            this.port.write(data, (err: Error | null | undefined, bytesWritten: number) => {
                if (err) {
                    reject(new ConnectionError(`Failed to send command: ${err.message}`, 'slcan'));
                } else {
                    // Small delay for command processing
                    setTimeout(resolve, 10);
                }
            });
        });
    }

    private onSerialData(data: Buffer): void {
        this.readBuffer += data.toString('ascii');
        this.processBuffer();
    }

    private processBuffer(): void {
        // SLCAN frames end with '\r' (carriage return)
        let index: number;
        while ((index = this.readBuffer.indexOf('\r')) !== -1) {
            const line = this.readBuffer.substring(0, index).trim();
            this.readBuffer = this.readBuffer.substring(index + 1);

            if (line.length > 0) {
                this.parseSLCANFrame(line);
            }
        }
    }

    private parseSLCANFrame(line: string): void {
        // SLCAN frame format:
        // Standard ID: tIIIDL... (11-bit ID, 3 hex chars)
        // Extended ID: TIIIIIIIDL... (29-bit ID, 8 hex chars)
        // RTR frames: r/R instead of t/T
        // Response to commands: \a (bell) for OK, \x07 for error

        if (line.length < 1) return;

        const type = line[0];

        // Ignore command responses (bell character)
        if (type === '\x07' || type === '\a') {
            return;
        }

        try {
            let frame: CanFrame | null = null;

            if (type === 't' || type === 'r') {
                // Standard frame (11-bit ID)
                // Format: tIIIDL... or rIIIDL...
                // III = 3 hex chars for 11-bit ID
                // D = DLC (1 hex char)
                // L... = data bytes (2 hex chars each)
                if (line.length < 5) return;

                const idHex = line.substring(1, 4);
                const id = parseInt(idHex, 16);
                const dlc = parseInt(line[4], 16);
                const isRtr = type === 'r';
                const data = isRtr ? new Uint8Array(0) : this.parseDataBytes(line.substring(5), dlc);

                frame = new CanFrame({
                    id,
                    data,
                    dlc,
                    isExtended: false,
                    timestamp: Date.now(),
                });
            } else if (type === 'T' || type === 'R') {
                // Extended frame (29-bit ID)
                // Format: TIIIIIIIDL... or RIIIIIIIDL...
                // IIIIIIII = 8 hex chars for 29-bit ID
                // D = DLC (1 hex char)
                // L... = data bytes (2 hex chars each)
                if (line.length < 10) return;

                const idHex = line.substring(1, 9);
                const id = parseInt(idHex, 16);
                const dlc = parseInt(line[9], 16);
                const isRtr = type === 'R';
                const data = isRtr ? new Uint8Array(0) : this.parseDataBytes(line.substring(10), dlc);

                frame = new CanFrame({
                    id,
                    data,
                    dlc,
                    isExtended: true,
                    timestamp: Date.now(),
                });
            }

            if (frame) {
                for (const cb of this.frameCallbacks) {
                    cb(frame);
                }
            }
        } catch (err) {
            Logger.warn(`SLCAN: Failed to parse frame: ${line} - ${err}`);
        }
    }

    private parseDataBytes(hexStr: string, expectedDlc: number): Uint8Array {
        const data = new Uint8Array(expectedDlc);
        for (let i = 0; i < expectedDlc; i++) {
            const byteHex = hexStr.substring(i * 2, i * 2 + 2);
            if (byteHex.length === 2) {
                data[i] = parseInt(byteHex, 16);
            }
        }
        return data;
    }

    private onSerialError(err: Error): void {
        Logger.error(`SLCAN: Serial port error: ${err.message}`);
        for (const cb of this.errorCallbacks) {
            cb(err);
        }
        if (this._state === CanBusState.Connected) {
            this.setState(CanBusState.Error);
        }
    }

    private onSerialClose(): void {
        Logger.info('SLCAN: Serial port closed');
        if (this._state !== CanBusState.Disconnected) {
            this.setState(CanBusState.Disconnected);
        }
    }

    async disconnect(): Promise<void> {
        Logger.info('SLCAN: disconnecting');
        await this.cleanup();
        this.setState(CanBusState.Disconnected);
    }

    private async cleanup(): Promise<void> {
        if (this.port) {
            try {
                // Close CAN channel
                await this.sendCommand('C');
            } catch {
                // Ignore errors during cleanup
            }

            this.port.removeAllListeners();
            if (this.port.isOpen) {
                await new Promise<void>((resolve) => {
                    this.port!.close(() => resolve());
                });
            }
            this.port = null;
        }
        this.channel = null;
    }

    async send(frame: CanFrame): Promise<void> {
        if (this._state !== CanBusState.Connected || !this.port || !this.port.isOpen) {
            throw new ConnectionError('Cannot send: not connected', 'slcan');
        }

        const cmd = this.buildSLCANCommand(frame);
        await this.sendCommand(cmd);
    }

    private buildSLCANCommand(frame: CanFrame): string {
        // Infer RTR: frame with DLC > 0 but no data bytes
        const isRtr = frame.dlc > 0 && frame.data.length === 0;
        
        let cmd = '';

        if (frame.isExtended) {
            cmd = isRtr ? 'R' : 'T';
            cmd += frame.id.toString(16).toUpperCase().padStart(8, '0');
        } else {
            cmd = isRtr ? 'r' : 't';
            cmd += frame.id.toString(16).toUpperCase().padStart(3, '0');
        }

        cmd += frame.dlc.toString(16).toUpperCase();

        if (!isRtr && frame.data.length > 0) {
            for (const byte of frame.data) {
                cmd += byte.toString(16).toUpperCase().padStart(2, '0');
            }
        }

        return cmd;
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