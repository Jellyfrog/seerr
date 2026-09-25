import JellyfinLogo from '@app/assets/services/jellyfin-icon.svg';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import JellyfinLogin from '@app/components/Login/JellyfinLogin';
import { Transition } from '@headlessui/react';
import { MediaServerType } from '@server/constants/server';
import { useState } from 'react';

interface LoginButtonProps {
  revalidate: () => void;
}

/**
 * Offers Jellyfin sign-in on the login page of a Plex media server. Opens
 * upstream's Jellyfin form in a modal; the sidecar route answers it.
 */
const LoginButton = ({ revalidate }: LoginButtonProps) => {
  const [show, setShow] = useState(false);

  return (
    <>
      <Button
        data-testid="jellyfin-signin-button"
        className="flex-1 bg-transparent"
        onClick={() => setShow(true)}
      >
        <JellyfinLogo />
        <span>Jellyfin</span>
      </Button>
      <Transition
        as="div"
        appear
        show={show}
        enter="transition-opacity ease-in-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-in-out duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Modal onCancel={() => setShow(false)}>
          <JellyfinLogin
            serverType={MediaServerType.JELLYFIN}
            revalidate={revalidate}
          />
        </Modal>
      </Transition>
    </>
  );
};

export default LoginButton;
