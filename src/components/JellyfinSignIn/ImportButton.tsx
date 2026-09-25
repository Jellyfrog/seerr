import Button from '@app/components/Common/Button';
import JellyfinImportModal from '@app/components/UserList/JellyfinImportModal';
import useJellyfinSignIn from '@app/hooks/useJellyfinSignIn';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { InboxArrowDownIcon } from '@heroicons/react/24/solid';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.JellyfinSignIn', {
  importJellyfinUsers: 'Import Jellyfin Users',
});

interface ImportButtonProps {
  /** The total number of users, which upstream's modal needs to dedupe. */
  userCount: number;
  onComplete: () => void;
}

/**
 * Imports Jellyfin users on a Plex media server, where upstream only offers
 * the Plex import. Imported users sign in with their Jellyfin account.
 */
const ImportButton = ({ userCount, onComplete }: ImportButtonProps) => {
  const intl = useIntl();
  const { enabled } = useJellyfinSignIn();
  const [show, setShow] = useState(false);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <Button
        className="mt-2 flex-grow sm:mt-0 lg:mr-2"
        buttonType="primary"
        onClick={() => setShow(true)}
      >
        <InboxArrowDownIcon />
        <span>{intl.formatMessage(messages.importJellyfinUsers)}</span>
      </Button>
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={show}
      >
        <JellyfinImportModal
          onCancel={() => setShow(false)}
          onComplete={() => {
            setShow(false);
            onComplete();
          }}
        >
          {userCount}
        </JellyfinImportModal>
      </Transition>
    </>
  );
};

export default ImportButton;
