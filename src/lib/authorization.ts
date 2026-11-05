/** Administrator privileges are assigned by immutable account ID, never by an unverified email. */
export function isAdmin(user: { id: string }, configured = process.env.ADMIN_USER_IDS): boolean {
  return (configured ?? "").split(",").some((id) => id.trim() === user.id && user.id.length > 0);
}
