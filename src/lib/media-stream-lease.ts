export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop());
}

export function keepMediaStreamForRequest(stream: MediaStream, requestRevision: number, currentRevision: number, destroyed: boolean): boolean {
  if (requestRevision === currentRevision && !destroyed) return true;
  stopMediaStream(stream);
  return false;
}
