import { describe, expect, it, vi } from 'vitest';
import { keepMediaStreamForRequest, stopMediaStream } from './media-stream-lease';

function fakeStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

describe('camera stream ownership', () => {
  it('stops a late stream after a newer request or page teardown', () => {
    const late = fakeStream();
    expect(keepMediaStreamForRequest(late.stream, 1, 2, false)).toBe(false);
    expect(late.stop).toHaveBeenCalledOnce();
    const afterDestroy = fakeStream();
    expect(keepMediaStreamForRequest(afterDestroy.stream, 3, 3, true)).toBe(false);
    expect(afterDestroy.stop).toHaveBeenCalledOnce();
  });

  it('leaves the current stream running until the component releases it', () => {
    const current = fakeStream();
    expect(keepMediaStreamForRequest(current.stream, 7, 7, false)).toBe(true);
    expect(current.stop).not.toHaveBeenCalled();
    stopMediaStream(current.stream);
    expect(current.stop).toHaveBeenCalledOnce();
  });
});
