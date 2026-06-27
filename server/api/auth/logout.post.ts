export default defineEventHandler(() => {
  // Stateless JWT auth — nothing to invalidate server-side. The frontend
  // clears its localStorage token.
  return { success: true }
})
