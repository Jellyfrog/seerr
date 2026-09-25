import Alert from '@app/components/Common/Alert';
import useJellyfinSignIn from '@app/hooks/useJellyfinSignIn';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import type { MainSettings } from '@server/lib/settings';
import axios from 'axios';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.JellyfinSignIn', {
  signInOnly:
    'Plex is the media server. Jellyfin is used for sign-in only, so its libraries are not scanned and do not affect availability.',
  enableSignIn: 'Enable Jellyfin Sign-In',
  enableSignInTip:
    'Allow users who have linked their Jellyfin account from their profile to sign in with it. Requires the connection below.',
  saved: 'Jellyfin sign-in setting saved.',
  saveFailed: 'Something went wrong while saving the Jellyfin sign-in setting.',
});

/**
 * Shown above upstream's Jellyfin settings on a Plex media server, where
 * Jellyfin can only be a sign-in provider. Holds the switch for it.
 */
const SettingsNotice = () => {
  const intl = useIntl();
  const settings = useSettings();
  const { addToast } = useToasts();
  const { revalidate: revalidateSignIn } = useJellyfinSignIn();
  const { data, mutate } = useSWR<MainSettings & { jellyfinSignIn?: boolean }>(
    '/api/v1/settings/main'
  );

  if (settings.currentSettings.mediaServerType !== MediaServerType.PLEX) {
    return null;
  }

  const toggle = async () => {
    try {
      await axios.post('/api/v1/settings/main', {
        jellyfinSignIn: !data?.jellyfinSignIn,
      });
      addToast(intl.formatMessage(messages.saved), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch {
      addToast(intl.formatMessage(messages.saveFailed), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      mutate();
      revalidateSignIn();
    }
  };

  return (
    <div className="mb-6">
      <Alert title={intl.formatMessage(messages.signInOnly)} type="info" />
      <div className="form-row">
        <label htmlFor="jellyfinSignIn" className="checkbox-label">
          {intl.formatMessage(messages.enableSignIn)}
          <span className="label-tip">
            {intl.formatMessage(messages.enableSignInTip)}
          </span>
        </label>
        <div className="form-input-area">
          <input
            type="checkbox"
            id="jellyfinSignIn"
            name="jellyfinSignIn"
            checked={!!data?.jellyfinSignIn}
            disabled={!data}
            onChange={toggle}
          />
        </div>
      </div>
    </div>
  );
};

export default SettingsNotice;
