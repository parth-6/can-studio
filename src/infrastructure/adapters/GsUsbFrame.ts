import { CanFrame } from '../../core/models/bus/CanFrame';
import {
    GS_USB_HOST_FRAME_HDR_SIZE,
    GS_USB_MAX_DATA_LEN,
    GS_USB_CAN_FLAG_FD,
    GS_USB_CAN_FLAG_BRS,
    GS_USB_CAN_FLAG_ESI,
    GsUsbHostFrameHeader,
} from './GsUsbConstants';

/**
 * Encode a CanFrame into gs_usb binary format for transmission
 * Returns a Buffer containing the host frame header + payload
 */
export function encodeGsUsbFrame(frame: CanFrame, channel: number, echoId: number): Buffer {
    const payload = frame.data;
    const dlc = frame.dlc;
    const isFd = frame.isFd;
    const isBrs = frame.isBrs;
    const isEsi = frame.isEsi;
    const isExtended = frame.isExtended;

    // Build CAN ID with flags
    let canId = frame.id;
    if (isExtended) {
        canId |= 0x80000000;  // Extended ID flag (bit 31)
    }
    if (isFd) {
        canId |= 0x00000002;  // GS_USB_CAN_FLAG_FD
    }
    if (isBrs) {
        canId |= 0x00000004;  // GS_USB_CAN_FLAG_BRS
    }
    if (isEsi) {
        canId |= 0x00000008;  // GS_USB_CAN_FLAG_ESI
    }

    // Build header
    const header = Buffer.alloc(16);
    header.writeUInt32LE(echoId, 0);      // echo_id
    header.writeUInt32LE(canId, 4);       // can_id
    header.writeUInt8(dlc, 8);            // can_dlc
    header.writeUInt8(channel, 9);        // channel
    header.writeUInt8(0, 10);             // flags (host frame flags, not CAN flags)
    header.writeUInt8(0, 11);             // reserved

    // Payload (up to 64 bytes for FD)
    const payloadBuffer = Buffer.from(payload);

    // Combine header + payload
    return Buffer.concat([header, payloadBuffer]);
}

/**
 * Decode a gs_usb binary frame from bulk IN endpoint
 * Returns CanFrame or null if parsing fails
 */
export function decodeGsUsbFrame(data: Buffer, channel: number): CanFrame | null {
    if (data.length < 16) {
        return null; // Too small for header
    }

    // Parse header (little-endian)
    const echoId = data.readUInt32LE(0);
    const canId = data.readUInt32LE(4);
    const dlc = data.readUInt8(8);
    const frameChannel = data.readUInt8(9);
    const flags = data.readUInt8(10);
    const reserved = data.readUInt8(11);

    // Verify channel matches
    if (frameChannel !== channel) {
        return null; // Wrong channel
    }

    // Extract CAN ID and flags
    const isExtended = (canId & 0x80000000) !== 0;
    const isFd = (canId & 0x02) !== 0;
    const isBrs = (canId & 0x04) !== 0;
    const isEsi = (canId & 0x08) !== 0;

    // Mask out flag bits to get actual CAN ID
    let id = canId & 0x1FFFFFFF; // 29-bit mask
    if (!isExtended) {
        id = id & 0x7FF; // 11-bit mask for standard
    }

    // Extract payload (after 16-byte header)
    const payloadStart = 16;
    const payloadLength = Math.min(dlc, data.length - payloadStart);
    const payload = data.subarray(payloadStart, payloadStart + payloadLength);

    // Create CanFrame
    return new CanFrame({
        id,
        data: new Uint8Array(payload),
        dlc,
        isExtended,
        isFd,
        isBrs,
        isEsi,
        timestamp: Date.now(),
    });
}

/**
 * Decode multiple frames from a bulk IN transfer buffer
 * gs_usb may pack multiple frames in one USB transfer
 */
export function decodeGsUsbFrames(data: Buffer, channel: number): CanFrame[] {
    const frames: CanFrame[] = [];
    let offset = 0;

    while (offset + 16 <= data.length) {
        // Check if we have enough data for header + payload
        const dlc = data.readUInt8(offset + 8);
        const frameSize = 16 + dlc;

        if (offset + frameSize > data.length) {
            break; // Incomplete frame
        }

        const frameData = data.subarray(offset, offset + frameSize);
        const frame = decodeGsUsbFrame(frameData, channel);

        if (frame) {
            frames.push(frame);
        }

        offset += frameSize;
    }

    return frames;
}

/**
 * Build a gs_usb control request payload for bit timing
 */
export function buildBittimingPayload(
    propSeg: number,
    phaseSeg1: number,
    phaseSeg2: number,
    sjw: number,
    brp: number
): Buffer {
    const buf = Buffer.alloc(20);
    buf.writeUInt32LE(propSeg, 0);
    buf.writeUInt32LE(phaseSeg1, 4);
    buf.writeUInt32LE(phaseSeg2, 8);
    buf.writeUInt32LE(sjw, 12);
    buf.writeUInt32LE(brp, 16);
    return buf;
}

/**
 * Build a gs_usb control request payload for FD data bit timing
 */
export function buildDataBittimingPayload(
    propSeg: number,
    phaseSeg1: number,
    phaseSeg2: number,
    sjw: number,
    brp: number
): Buffer {
    const buf = Buffer.alloc(20);
    buf.writeUInt32LE(propSeg, 0);
    buf.writeUInt32LE(phaseSeg1, 4);
    buf.writeUInt32LE(phaseSeg2, 8);
    buf.writeUInt32LE(sjw, 12);
    buf.writeUInt32LE(brp, 16);
    return buf;
}

/**
 * Build channel mode payload (start/stop)
 */
export function buildModePayload(mode: number, flags: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(mode, 0);
    buf.writeUInt32LE(flags, 4);
    return buf;
}

/**
 * Build termination payload
 */
export function buildTerminationPayload(state: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(state, 0);
    return buf;
}

/**
 * Build host format payload (endianness)
 */
export function buildHostFormatPayload(littleEndian: boolean): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(littleEndian ? 0x00000000 : 0x01000000, 0);
    return buf;
}

/**
 * Parse device config response
 */
export function parseDeviceConfig(data: Buffer): {
    nchannels: number;
    swVersion: number;
    hwVersion: number;
} | null {
    if (data.length < 64) return null;
    return {
        nchannels: data.readUInt8(4) + 1, // nchannels is (n-1)
        swVersion: data.readUInt32LE(8),
        hwVersion: data.readUInt32LE(12),
    };
}

/**
 * Parse bit timing constants (classic CAN)
 */
export function parseBtConst(data: Buffer): {
    feature: number;
    fclkCan: number;
    tseg1Min: number;
    tseg1Max: number;
    tseg2Min: number;
    tseg2Max: number;
    sjwMax: number;
    brpMin: number;
    brpMax: number;
    brpInc: number;
} | null {
    if (data.length < 36) return null;
    return {
        feature: data.readUInt32LE(0),
        fclkCan: data.readUInt32LE(4),
        tseg1Min: data.readUInt32LE(8),
        tseg1Max: data.readUInt32LE(12),
        tseg2Min: data.readUInt32LE(16),
        tseg2Max: data.readUInt32LE(20),
        sjwMax: data.readUInt32LE(24),
        brpMin: data.readUInt32LE(28),
        brpMax: data.readUInt32LE(32),
        brpInc: data.readUInt32LE(36),
    };
}

/**
 * Parse extended bit timing constants (CAN FD)
 */
export function parseBtConstExt(data: Buffer): {
    feature: number;
    fclkCan: number;
    tseg1Min: number;
    tseg1Max: number;
    tseg2Min: number;
    tseg2Max: number;
    sjwMax: number;
    brpMin: number;
    brpMax: number;
    brpInc: number;
    dtseg1Min: number;
    dtseg1Max: number;
    dtseg2Min: number;
    dtseg2Max: number;
    dsjwMax: number;
    dbrpMin: number;
    dbrpMax: number;
    dbrpInc: number;
} | null {
    if (data.length < 68) return null;
    return {
        feature: data.readUInt32LE(0),
        fclkCan: data.readUInt32LE(4),
        tseg1Min: data.readUInt32LE(8),
        tseg1Max: data.readUInt32LE(12),
        tseg2Min: data.readUInt32LE(16),
        tseg2Max: data.readUInt32LE(20),
        sjwMax: data.readUInt32LE(24),
        brpMin: data.readUInt32LE(28),
        brpMax: data.readUInt32LE(32),
        brpInc: data.readUInt32LE(36),
        dtseg1Min: data.readUInt32LE(40),
        dtseg1Max: data.readUInt32LE(44),
        dtseg2Min: data.readUInt32LE(48),
        dtseg2Max: data.readUInt32LE(52),
        dsjwMax: data.readUInt32LE(56),
        dbrpMin: data.readUInt32LE(60),
        dbrpMax: data.readUInt32LE(64),
        dbrpInc: data.readUInt32LE(68),
    };
}

/**
 * Parse channel state response
 */
export function parseChannelState(data: Buffer): {
    state: number;
    rxerr: number;
    txerr: number;
} | null {
    if (data.length < 12) return null;
    return {
        state: data.readUInt32LE(0),
        rxerr: data.readUInt32LE(4),
        txerr: data.readUInt32LE(8),
    };
}

/**
 * Parse termination state response
 */
export function parseTerminationState(data: Buffer): boolean | null {
    if (data.length < 4) return null;
    return data.readUInt32LE(0) !== 0;
}

/**
 * Parse timestamp response
 */
export function parseTimestamp(data: Buffer): number | null {
    if (data.length < 4) return null;
    return data.readUInt32LE(0);
}