import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
} from 'lucide-react';
import { t } from '../i18n';
import { formatCallDuration, formatMessageTime } from '../lib/connectLogic';
import type { CallRecord, Language, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface CallsViewProps {
  lang: Language;
  currentUser: UserProfile;
  calls: CallRecord[];
  onRedial: (conversationId: string, type: 'audio' | 'video') => void;
}

export function CallsView({
  lang,
  currentUser,
  calls,
  onRedial,
}: CallsViewProps) {
  const dict = t(lang);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {dict.callHistory}
          </h1>
          <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
            {calls.length} {dict.calls}
          </span>
        </div>

        {calls.length === 0 ? (
          <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500 dark:text-slate-400">
            {dict.noCallsYet}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
            {calls.map((c) => {
              const isOutgoing = c.caller_id === currentUser.id;
              const peers = c.participants.filter(
                (p) => p.user_id !== currentUser.id
              );
              const title =
                c.conversation_title ||
                peers.map((p) => p.user?.full_name).filter(Boolean).join('، ') ||
                c.caller?.full_name ||
                dict.calls;
              const primaryPeer = peers[0]?.user || c.caller;

              const isMissed =
                c.status === 'missed' || c.status === 'declined';
              const DirectionIcon = isMissed
                ? PhoneMissed
                : isOutgoing
                ? PhoneOutgoing
                : PhoneIncoming;

              const statusLabel = isMissed
                ? c.status === 'declined'
                  ? dict.declinedCall
                  : dict.missedCall
                : isOutgoing
                ? dict.outgoingCall
                : dict.incomingCall;

              return (
                <div
                  key={c.id}
                  className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={primaryPeer?.avatar_url}
                      name={title}
                      size="md"
                      isGroup={peers.length > 1}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <DirectionIcon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isMissed
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        />
                        <span>{statusLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {formatMessageTime(c.started_at, lang)}
                        </span>
                        {c.ended_at && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              {formatCallDuration(c.started_at, c.ended_at)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRedial(c.conversation_id, c.type)}
                    aria-label={`${c.type === 'video' ? dict.videoCall : dict.audioCall} ${title}`}
                    className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-emerald-700 hover:text-white hover:border-emerald-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    {c.type === 'video' ? (
                      <Video className="w-4 h-4" />
                    ) : (
                      <Phone className="w-4 h-4" />
                    )}
                    <span>{c.type === 'video' ? dict.videoCall : dict.audioCall}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
