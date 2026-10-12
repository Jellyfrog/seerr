import Alert from '@app/components/Common/Alert';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SignInOnlyNotice', {
  signInOnly:
    '{mediaServerName} is the media server, and only one server can fill that role. {signInServerName} is used for sign-in only, so its libraries are not scanned and do not affect availability.',
});

interface SignInOnlyNoticeProps {
  mediaServerName: string;
  signInServerName: string;
}

/**
 * Replaces a server's library and scan controls while it is only a sign-in
 * provider, since the other server is the media backend.
 */
const SignInOnlyNotice = ({
  mediaServerName,
  signInServerName,
}: SignInOnlyNoticeProps) => {
  const intl = useIntl();

  return (
    <Alert
      title={intl.formatMessage(messages.signInOnly, {
        mediaServerName,
        signInServerName,
      })}
      type="info"
    />
  );
};

export default SignInOnlyNotice;
