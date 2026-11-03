export function appointmentTime(startSeconds: number, advance: boolean): number {
  return startSeconds - (advance ? 30 * 60 : 0);
}
