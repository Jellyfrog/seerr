import JellyfinLogo from '@app/assets/services/jellyfin-icon.svg';
import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LinkJellyfinModal from '@app/components/UserProfile/UserSettings/UserLinkedAccountsSettings/LinkJellyfinModal';
import useJellyfinSignIn from '@app/hooks/useJellyfinSignIn';
import useSettings from '@app/hooks/useSettings';
import { UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { LinkIcon, TrashIcon } from '@heroicons/react/24/solid';
import { MediaServerType } from '@server/constants/server';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.JellyfinSignIn', {
  jellyfinSignIn: 'Jellyfin Sign-In',
  jellyfinSignInHint:
    'Link your Jellyfin account to also sign in with it. Plex remains the media server.',
  linkJellyfin: 'Link Jellyfin Account',
  unlinkFailed: 'Something went wrong while unlinking your Jellyfin account.',
});

/**
 * The Jellyfin account on the linked-accounts page of a Plex media server.
 * Upstream's list only knows about the media server's own accounts, except
 * for users whose type is Jellyfin, whom it already lists.
 */
const LinkedAccount = () => {
  const intl = useIntl();
  const settings = useSettings();
  const router = useRouter();
  const { enabled } = useJellyfinSignIn();
  const { user: currentUser } = useUser();
  const { user, revalidate } = useUser({ id: Number(router.query.userId) });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    !user ||
    settings.currentSettings.mediaServerType !== MediaServerType.PLEX ||
    user.userType === UserType.JELLYFIN
  ) {
    return null;
  }

  const linked = !!user.jellyfinUsername;
  const canLink = !linked && enabled && currentUser?.id === user.id;

  if (!linked && !canLink) {
    return null;
  }

  const unlink = async () => {
    setError(null);
    try {
      await axios.delete(
        `/api/v1/user/${user.id}/settings/linked-accounts/jellyfin`
      );
    } catch {
      setError(intl.formatMessage(messages.unlinkFailed));
    }
    await revalidate();
  };

  return (
    <div className="mt-10">
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.jellyfinSignIn)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.jellyfinSignInHint)}
        </p>
      </div>
      {error && <Alert title={error} type="error" />}
      {linked ? (
        <div className="flex items-center gap-4 overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
          <div className="w-12">
            <JellyfinLogo />
          </div>
          <div>
            <div className="truncate text-sm font-bold text-gray-300">
              Jellyfin
            </div>
            <div className="text-xl font-semibold text-white">
              {user.jellyfinUsername}
            </div>
          </div>
          <div className="flex-grow" />
          <ConfirmButton
            onClick={unlink}
            confirmText={intl.formatMessage(globalMessages.areyousure)}
          >
            <TrashIcon />
            <span>{intl.formatMessage(globalMessages.delete)}</span>
          </ConfirmButton>
        </div>
      ) : (
        <Button buttonType="ghost" onClick={() => setShowLinkModal(true)}>
          <LinkIcon />
          <span>{intl.formatMessage(messages.linkJellyfin)}</span>
        </Button>
      )}
      <LinkJellyfinModal
        show={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        onSave={() => {
          setShowLinkModal(false);
          revalidate();
        }}
        // Quick Connect linking is upstream's and only runs on a Jellyfin
        // media server; its button is hidden here anyway.
        onSwitchToQuickConnect={() => undefined}
      />
    </div>
  );
};

export default LinkedAccount;
