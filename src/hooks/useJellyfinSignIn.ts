import useSWR from 'swr';

/**
 * Whether users may sign in with a linked Jellyfin account next to a Plex
 * media server. Served by the sidecar route, so public settings stay as
 * upstream defines them.
 */
const useJellyfinSignIn = () => {
  const { data, mutate } = useSWR<{ enabled: boolean }>(
    '/api/v1/auth/jellyfin/secondary'
  );

  return { enabled: !!data?.enabled, revalidate: mutate };
};

export default useJellyfinSignIn;
