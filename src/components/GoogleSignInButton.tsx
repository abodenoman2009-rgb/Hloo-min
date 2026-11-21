import { useEffect, useRef } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        ux_mode?: 'popup';
        use_fedcm_for_prompt?: boolean;
      }) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

let gsiPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gsiPromise = null;
        reject(new Error('Failed to load Google Identity Services'));
      };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}

interface Props {
  clientId: string;
  lang: 'ar' | 'en';
  disabled?: boolean;
  onCredential: (idToken: string) => void;
  onError: (message: string) => void;
}

/**
 * Google Identity Services button. Returns a Google-signed ID token that the
 * server verifies against GOOGLE_OAUTH_CLIENT_ID. Works on desktop and mobile
 * browsers without Firebase's authorized-domains list.
 */
export function GoogleSignInButton({ clientId, lang, disabled, onCredential, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onCredential, onError });
  cbRef.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: (response) => {
            if (response.credential) {
              cbRef.current.onCredential(response.credential);
            } else {
              cbRef.current.onError(
                lang === 'ar'
                  ? 'لم يرجع Google بيانات تسجيل الدخول. حاول مرة أخرى.'
                  : 'Google did not return sign-in credentials. Please try again.'
              );
            }
          },
        });
        const width = Math.min(400, Math.max(200, ref.current.parentElement?.clientWidth ?? 320));
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
          locale: lang,
        });
      })
      .catch(() => {
        cbRef.current.onError(
          lang === 'ar'
            ? 'تعذر تحميل خدمة Google. تحقق من الاتصال أو سجّل الدخول بالبريد الإلكتروني.'
            : 'Could not load Google Sign-In. Check your connection or sign in with email.'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, lang]);

  return (
    <div
      ref={ref}
      className={`flex justify-center min-h-[44px] ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      dir="ltr"
    />
  );
}
