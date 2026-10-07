import { BrowserQRCodeReader } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

export function createQrReader() {
  return new BrowserQRCodeReader(new Map([[DecodeHintType.TRY_HARDER, true]]), {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 300,
    tryPlayVideoTimeout: 5000,
  });
}

export function cameraConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      // Ideal settings allow older webcams to fall back to their supported size.
      width: { ideal: 1920 }, height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  };
}
