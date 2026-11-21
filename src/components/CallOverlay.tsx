import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { t } from '../i18n';
import { formatSecondsTimer } from '../lib/connectLogic';
import type { CallRecord, Language, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface CallOverlayProps {
  lang: Language;
  currentUser: UserProfile;
  activeCall: CallRecord | null;
  incomingCall: CallRecord | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  mediaWarning: boolean;
  onAnswerIncoming: () => void;
  onDeclineIncoming: () => void;
  onEndCall: () => void;
  onToggleMute: (muted: boolean) => void;
  onToggleCamera: (enabled: boolean) => void;
}

export function CallOverlay({
  lang,
  currentUser,
  activeCall,
  incomingCall,
  localStream,
  remoteStreams,
  mediaWarning,
  onAnswerIncoming,
  onDeclineIncoming,
  onEndCall,
  onToggleMute,
  onToggleCamera,
}: CallOverlayProps) {
  const dict = t(lang);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setMuted(false);
    setCameraOn(activeCall?.type === 'video');
    setElapsedSec(0);
    if (!activeCall) return;
    const timer = window.setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall?.id]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, cameraOn]);

  // Incoming Call Banner
  if (incomingCall && !activeCall) {
    const callerName = incomingCall.caller?.full_name || dict.incomingCall;
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dict.incomingCall}
        className="fixed bottom-6 end-6 z-50 w-80 sm:w-96 rounded-2xl bg-slate-900 text-white border border-slate-700 p-5 shadow-2xl"
      >
        <div className="flex items-center gap-3.5">
          <Avatar
            src={incomingCall.caller?.avatar_url}
            name={callerName}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-emerald-400 font-semibold">
              {incomingCall.type === 'video' ? dict.videoCall : dict.audioCall}
              <span aria-hidden="true"> · </span>
              <span>{dict.incomingCall}</span>
            </div>
            <div className="text-base font-bold truncate mt-0.5">
              {callerName}
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDeclineIncoming}
            className="h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <PhoneOff className="w-4 h-4" />
            <span>{dict.declineCall}</span>
          </button>
          <button
            type="button"
            onClick={onAnswerIncoming}
            className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Phone className="w-4 h-4" />
            <span>{dict.answerCall}</span>
          </button>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const peers = activeCall.participants.filter(
    (p) => p.user_id !== currentUser.id
  );
  const title =
    activeCall.conversation_title ||
    peers.map((p) => p.user?.full_name).filter(Boolean).join('، ') ||
    dict.activeCall;

  const remoteEntries = Array.from(remoteStreams.entries());
  const hasLocalVideo =
    activeCall.type === 'video' &&
    cameraOn &&
    Boolean(localStream?.getVideoTracks().length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.activeCall}
      className="fixed inset-0 z-50 bg-slate-950/95 text-white flex flex-col justify-between p-6"
    >
      {/* Top Info */}
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <div>
          <div className="text-xs text-emerald-400 font-semibold">
            {activeCall.type === 'video' ? dict.videoCall : dict.audioCall}
            <span aria-hidden="true"> · </span>
            <span>
              {activeCall.status === 'ringing' ? dict.calling : dict.activeCall}
            </span>
          </div>
          <h2 className="text-xl font-bold mt-1">{title}</h2>
        </div>
        <div className="font-mono-tabular text-lg font-semibold px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
          {formatSecondsTimer(elapsedSec)}
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 max-w-5xl w-full mx-auto my-6 flex items-center justify-center">
        {remoteEntries.length > 0 && activeCall.type === 'video' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full h-full max-h-[65vh]">
            {remoteEntries.map(([peerId, stream]) => (
              <RemoteVideoTile key={peerId} stream={stream} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {peers.map((p) => (
                <div key={p.user_id} className="flex flex-col items-center gap-2">
                  <Avatar
                    src={p.user?.avatar_url}
                    name={p.user?.full_name || 'Peer'}
                    size="xl"
                  />
                  <span className="text-sm font-semibold">
                    {p.user?.full_name}
                  </span>
                  <span className="text-xs text-slate-400">{p.status}</span>
                </div>
              ))}
            </div>
            {(mediaWarning || !hasLocalVideo) && (
              <p className="text-xs text-slate-400">
                {dict.cameraUnavailableNote}
              </p>
            )}
          </div>
        )}

        {/* Local Self-Preview PIP */}
        {hasLocalVideo && (
          <div className="fixed bottom-28 end-8 w-40 h-52 rounded-2xl overflow-hidden border border-slate-700 bg-slate-900 shadow-xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="max-w-xl w-full mx-auto flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onToggleMute(next);
          }}
          aria-label={muted ? dict.unmuteMic : dict.muteMic}
          className={`h-12 px-5 rounded-2xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
            muted
              ? 'bg-red-600/20 border-red-500 text-red-200'
              : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white'
          }`}
        >
          {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          <span>{muted ? dict.unmuteMic : dict.muteMic}</span>
        </button>

        {activeCall.type === 'video' && (
          <button
            type="button"
            onClick={() => {
              const next = !cameraOn;
              setCameraOn(next);
              onToggleCamera(next);
            }}
            aria-label={cameraOn ? dict.turnOffCamera : dict.turnOnCamera}
            className={`h-12 px-5 rounded-2xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
              !cameraOn
                ? 'bg-red-600/20 border-red-500 text-red-200'
                : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            {cameraOn ? (
              <Video className="w-4 h-4" />
            ) : (
              <VideoOff className="w-4 h-4" />
            )}
            <span>{cameraOn ? dict.turnOffCamera : dict.turnOnCamera}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setSpeakerOn((s) => !s)}
          aria-label={speakerOn ? dict.speakerOn : dict.speakerOff}
          className="h-12 px-4 rounded-2xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          {speakerOn ? (
            <Volume2 className="w-4 h-4" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">
            {speakerOn ? dict.speakerOn : dict.speakerOff}
          </span>
        </button>

        <button
          type="button"
          onClick={onEndCall}
          aria-label={dict.endCall}
          className="h-12 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          <PhoneOff className="w-4 h-4" />
          <span>{dict.endCall}</span>
        </button>
      </div>
    </div>
  );
}

function RemoteVideoTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="w-full h-full object-cover rounded-2xl border border-slate-800 bg-slate-900"
    />
  );
}
