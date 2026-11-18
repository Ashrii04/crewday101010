import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { subscribeToNotifications } from '@/services/notificationService'

/** Live count of the signed-in member's unread notifications (0 for guests). */
export function useUnreadNotifications(): number {
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user) {
      setUnread(0)
      return
    }
    return subscribeToNotifications(user.uid, (notifications) =>
      setUnread(notifications.filter((entry) => !entry.read).length),
    )
  }, [user])

  return unread
}
