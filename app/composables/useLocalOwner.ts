import { localOwnerFor } from '~/lib/localScope'

/** Whose local Snacket content to show: the guest, a signed-in account, or nobody yet. */
export function useLocalOwner() {
  const { status, userId } = useAuth()
  return computed(() => localOwnerFor(status.value, userId.value))
}
