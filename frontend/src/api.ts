import { QueryClient, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'

// Cached data is shown at once when a page is opened again and refreshed in the background.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

// Calls the backend API and throws the server's error message on failure.
export async function apiFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...init?.headers },
  })
  const result = response.status === 204 ? null : await response.json()
  if (!response.ok) throw Object.assign(new Error(result?.error?.message ?? 'So‘rov bajarilmadi'), { code: result?.error?.code as string | undefined })
  return result as T
}

// Rows added before the server confirms them get a temporary ID and cannot be changed until then.
export const optimisticId = () => `optimistic-${Date.now()}`
export const isOptimistic = (id: string) => id.startsWith('optimistic-')

// A one-date list after saving a row: an edited row is replaced, a new one added, and a row moved to another date leaves the list.
export function applySaved<T extends { id: string; recordDate: string }>(rows: T[], shownDate: string, saved: T, editedId?: string): T[] {
  const shown = saved.recordDate.slice(0, 10) === shownDate
  if (editedId) return shown ? rows.map((row) => row.id === editedId ? saved : row) : rows.filter((row) => row.id !== editedId)
  return shown ? [...rows, saved] : rows
}

type OptimisticOptions<TData, TInput, TResult> = {
  // Cache entry shown on the page, and the prefix of every entry to refetch after the change.
  queryKey: QueryKey
  invalidate: QueryKey
  mutationFn: (input: TInput) => Promise<TResult>
  // How the page should look once the change succeeds; omitted for changes the server may well refuse.
  update?: (data: TData, input: TInput) => TData
  onError: (message: string) => void
  onSuccess?: (result: TResult, input: TInput) => void
}

// Shows a change at once, restores the previous data if the server refuses it, and refetches afterwards.
export function useOptimisticMutation<TData, TInput, TResult = unknown>(options: OptimisticOptions<TData, TInput, TResult>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: options.mutationFn,
    onMutate: async (input: TInput) => {
      if (!options.update) return { key: options.queryKey, previous: undefined }
      await client.cancelQueries({ queryKey: options.invalidate })
      const previous = client.getQueryData<TData>(options.queryKey)
      if (previous !== undefined) client.setQueryData(options.queryKey, options.update(previous, input))
      return { key: options.queryKey, previous }
    },
    onError: (cause, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(context.key, context.previous)
      options.onError(cause.message)
    },
    onSuccess: options.onSuccess,
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: options.invalidate }),
      // The report and dashboard are calculated from the monitoring records, so they are refreshed too.
      client.invalidateQueries({ queryKey: ['report'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]),
  })
}
