import Alert from '@app/components/Common/Alert';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  getJellyfinServerName,
  hasJellyfinAccount,
  isJellyfinPrimary,
} from '@app/utils/mediaServer';
import type { UserResultsResponse } from '@server/interfaces/api/userInterfaces';
import { canModifyUser } from '@server/lib/permissions';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface JellyfinImportProps {
  onCancel?: () => void;
  onComplete?: () => void;
}

const messages = defineMessages('components.UserList', {
  importfromJellyfin: 'Import {mediaServerName} Users',
  importfromJellyfinerror:
    'Something went wrong while importing {mediaServerName} users.',
  importedfromJellyfin:
    '<strong>{userCount}</strong> {mediaServerName} {userCount, plural, one {user} other {users}} imported successfully!',
  importedUsersNoPassword:
    'Imported users do not have a {applicationTitle} password set. If you disable {mediaServerName} sign-in, they will need to set a password from their profile or via a password reset link.',
  user: 'User',
  seerrUser: '{applicationTitle} User',
  createNewUser: 'Create new user',
  noJellyfinuserstoimport: 'There are no {mediaServerName} users to import.',
  newJellyfinsigninenabled:
    'The <strong>Enable New {mediaServerName} Sign-In</strong> setting is currently enabled. {mediaServerName} users with library access do not need to be imported in order to sign in.',
});

const JellyfinImportModal: React.FC<JellyfinImportProps> = ({
  onCancel,
  onComplete,
}) => {
  const intl = useIntl();
  const settings = useSettings();
  const { addToast } = useToasts();
  const [isImporting, setImporting] = useState(false);
  const { user: currentUser } = useUser();
  // Selected Jellyfin user id -> id of the existing Seerr user to link it to,
  // or null to create a new Seerr user for it.
  const [selection, setSelection] = useState<Record<string, number | null>>({});
  const mediaServerName = getJellyfinServerName(
    settings.currentSettings.jellyfinServerType
  );
  const { data, error } = useSWR<
    {
      id: string;
      title: string;
      username: string;
      email: string;
      thumb: string;
    }[]
  >(`/api/v1/settings/jellyfin/users`, {
    revalidateOnMount: true,
  });

  // Every Seerr user, independent of the user list's search and paging: the
  // first request only learns the total, the second fetches them all.
  const { data: userCount } = useSWR<UserResultsResponse>(
    '/api/v1/user?take=1'
  );
  const { data: existingUsers } = useSWR<UserResultsResponse>(
    userCount ? `/api/v1/user?take=${userCount.pageInfo.results}` : null
  );

  const importUsers = async () => {
    setImporting(true);

    try {
      const { data: createdUsers } = await axios.post(
        '/api/v1/user/import-from-jellyfin',
        {
          jellyfinUserIds: Object.keys(selection).filter(
            (id) => selection[id] === null
          ),
          links: Object.entries(selection)
            .filter(([, userId]) => userId !== null)
            .map(([jellyfinUserId, userId]) => ({ jellyfinUserId, userId })),
        }
      );

      if (!createdUsers.length) {
        throw new Error('No users were imported from Jellyfin.');
      }

      addToast(
        intl.formatMessage(messages.importedfromJellyfin, {
          userCount: createdUsers.length,
          strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          mediaServerName,
        }),
        {
          autoDismiss: true,
          appearance: 'success',
        }
      );

      addToast(
        intl.formatMessage(messages.importedUsersNoPassword, {
          applicationTitle: settings.currentSettings.applicationTitle,
          mediaServerName,
        }),
        {
          autoDismiss: false,
          appearance: 'warning',
        }
      );

      if (onComplete) {
        onComplete();
      }
    } catch {
      addToast(
        intl.formatMessage(messages.importfromJellyfinerror, {
          mediaServerName,
        }),
        {
          autoDismiss: true,
          appearance: 'error',
        }
      );
    } finally {
      setImporting(false);
    }
  };

  // Seerr users a Jellyfin account may be attached to: those without one that
  // the current user may modify (the same rule the server applies).
  const linkCandidates =
    existingUsers?.results.filter(
      (u) => !hasJellyfinAccount(u) && canModifyUser(u, currentUser)
    ) ?? [];
  const linkedUserIds = new Set(Object.values(selection));
  const unlinkedCandidates = linkCandidates.filter(
    (u) => !linkedUserIds.has(u.id)
  );
  const importedJellyfinIds = new Set(
    existingUsers?.results.map((u) => u.jellyfinUserId)
  );
  const importableUsers =
    data?.filter((user) => !importedJellyfinIds.has(user.id)) ?? [];
  const selectedCount = Object.keys(selection).length;
  const seerrUserLabel = intl.formatMessage(messages.seerrUser, {
    applicationTitle: settings.currentSettings.applicationTitle,
  });

  const isSelectedUser = (jellyfinId: string): boolean =>
    jellyfinId in selection;

  const isAllUsers = (): boolean => selectedCount === data?.length;

  const toggleUser = (jellyfinId: string): void => {
    setSelection(({ [jellyfinId]: current, ...rest }) =>
      current === undefined ? { ...rest, [jellyfinId]: null } : rest
    );
  };

  const toggleAllUsers = (): void => {
    setSelection(
      data && !isAllUsers()
        ? Object.fromEntries(
            data.map((user) => [user.id, selection[user.id] ?? null])
          )
        : {}
    );
  };

  return (
    <Modal
      loading={!data && !error}
      title={intl.formatMessage(messages.importfromJellyfin, {
        mediaServerName,
      })}
      onOk={() => {
        importUsers();
      }}
      okDisabled={isImporting || !selectedCount}
      okText={intl.formatMessage(
        isImporting ? globalMessages.importing : globalMessages.import
      )}
      onCancel={onCancel}
    >
      {data?.length ? (
        <>
          {settings.currentSettings.newPlexLogin &&
            isJellyfinPrimary(settings.currentSettings.mediaServerType) && (
              <Alert
                title={intl.formatMessage(messages.newJellyfinsigninenabled, {
                  mediaServerName,
                  strong: (msg: React.ReactNode) => (
                    <strong className="font-semibold text-white">{msg}</strong>
                  ),
                })}
                type="info"
              />
            )}
          <div className="flex flex-col">
            <div className="-mx-4 sm:mx-0">
              <div className="inline-block min-w-full py-2 align-middle">
                <div className="overflow-hidden shadow sm:rounded-lg">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className="w-16 bg-gray-500 px-4 py-3">
                          <span
                            role="checkbox"
                            tabIndex={0}
                            aria-checked={isAllUsers()}
                            onClick={() => toggleAllUsers()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Space') {
                                toggleAllUsers();
                              }
                            }}
                            className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center justify-center pt-2 focus:outline-none"
                          >
                            <span
                              aria-hidden="true"
                              className={`${
                                isAllUsers() ? 'bg-indigo-500' : 'bg-gray-800'
                              } absolute mx-auto h-4 w-9 rounded-full transition-colors duration-200 ease-in-out`}
                            />
                            <span
                              aria-hidden="true"
                              className={`${
                                isAllUsers() ? 'translate-x-5' : 'translate-x-0'
                              } absolute left-0 inline-block h-5 w-5 transform rounded-full border border-gray-200 bg-white shadow transition-transform duration-200 ease-in-out group-focus:border-blue-300 group-focus:ring`}
                            />
                          </span>
                        </th>
                        <th className="bg-gray-500 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                          {intl.formatMessage(messages.user)}
                        </th>
                        {linkCandidates.length > 0 && (
                          <th className="bg-gray-500 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                            {seerrUserLabel}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700 bg-gray-600">
                      {importableUsers.map((user) => (
                        <tr key={`user-${user.id}`}>
                          <td className="whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                            <span
                              role="checkbox"
                              tabIndex={0}
                              aria-checked={isSelectedUser(user.id)}
                              onClick={() => toggleUser(user.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Space') {
                                  toggleUser(user.id);
                                }
                              }}
                              className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center justify-center pt-2 focus:outline-none"
                            >
                              <span
                                aria-hidden="true"
                                className={`${
                                  isSelectedUser(user.id)
                                    ? 'bg-indigo-500'
                                    : 'bg-gray-800'
                                } absolute mx-auto h-4 w-9 rounded-full transition-colors duration-200 ease-in-out`}
                              />
                              <span
                                aria-hidden="true"
                                className={`${
                                  isSelectedUser(user.id)
                                    ? 'translate-x-5'
                                    : 'translate-x-0'
                                } absolute left-0 inline-block h-5 w-5 transform rounded-full border border-gray-200 bg-white shadow transition-transform duration-200 ease-in-out group-focus:border-blue-300 group-focus:ring`}
                              />
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                            <div className="flex items-center">
                              <CachedImage
                                type="avatar"
                                className="h-10 w-10 flex-shrink-0 rounded-full"
                                src={user.thumb}
                                alt=""
                                width={40}
                                height={40}
                              />
                              <div className="ml-4">
                                <div className="text-base font-bold leading-5">
                                  {user.username}
                                </div>
                                {/* {user.username &&
                                  user.username.toLowerCase() !==
                                  user.email && (
                                    <div className="text-sm leading-5 text-gray-300">
                                      {user.email}
                                    </div>
                                  )} */}
                              </div>
                            </div>
                          </td>
                          {linkCandidates.length > 0 && (
                            <td className="whitespace-nowrap px-1 py-4 text-sm leading-5 text-gray-100 md:px-6">
                              {/* Only selected rows get a target, which also
                                    keeps the option lists off unselected rows. */}
                              {isSelectedUser(user.id) && (
                                <select
                                  aria-label={seerrUserLabel}
                                  value={selection[user.id] ?? ''}
                                  onChange={(e) =>
                                    setSelection((current) => ({
                                      ...current,
                                      [user.id]: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    }))
                                  }
                                >
                                  <option value="">
                                    {intl.formatMessage(messages.createNewUser)}
                                  </option>
                                  {linkCandidates
                                    .filter((u) => u.id === selection[user.id])
                                    .concat(unlinkedCandidates)
                                    .map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.displayName}
                                      </option>
                                    ))}
                                </select>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <Alert
          title={intl.formatMessage(messages.noJellyfinuserstoimport, {
            mediaServerName,
          })}
          type="info"
        />
      )}
    </Modal>
  );
};

export default JellyfinImportModal;
