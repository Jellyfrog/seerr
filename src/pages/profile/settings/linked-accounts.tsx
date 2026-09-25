import JellyfinSignInLinkedAccount from '@app/components/JellyfinSignIn/LinkedAccount';
import UserSettings from '@app/components/UserProfile/UserSettings';
import UserLinkedAccountsSettings from '@app/components/UserProfile/UserSettings/UserLinkedAccountsSettings';
import type { NextPage } from 'next';

const UserSettingsLinkedAccountsPage: NextPage = () => {
  return (
    <UserSettings>
      <UserLinkedAccountsSettings />
      <JellyfinSignInLinkedAccount />
    </UserSettings>
  );
};

export default UserSettingsLinkedAccountsPage;
