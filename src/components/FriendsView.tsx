import { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  MessageSquare,
  Phone,
  Search,
  UserMinus,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { t } from '../i18n';
import { api } from '../lib/api';
import type { Friendship, Language, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface FriendsViewProps {
  lang: Language;
  friendships: Friendship[];
  onRefreshFriendships: () => Promise<void>;
  onStartDirectChat: (userId: string) => Promise<void>;
  onStartDirectCall: (userId: string, type: 'audio' | 'video') => Promise<void>;
}

export function FriendsView({
  lang,
  friendships,
  onRefreshFriendships,
  onStartDirectChat,
  onStartDirectCall,
}: FriendsViewProps) {
  const dict = t(lang);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<UserProfile[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .searchUsers(query)
      .then((res) => {
        if (!cancelled) setDirectory(res.users);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [query, friendships]);

  const incoming = friendships.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming'
  );
  const outgoing = friendships.filter(
    (f) => f.status === 'pending' && f.direction === 'outgoing'
  );
  const accepted = friendships.filter((f) => f.status === 'accepted');
  const blocked = friendships.filter(
    (f) => f.status === 'blocked' && f.direction === 'outgoing'
  );

  const relationByUserId = new Map<string, Friendship>();
  for (const f of friendships) {
    relationByUserId.set(f.other_user.id, f);
  }

  async function runAction(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await onRefreshFriendships();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {dict.friends}
          </h1>
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dict.searchUsersPlaceholder}
              aria-label={dict.searchUsersPlaceholder}
              className="w-full h-11 ps-9 pe-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Incoming Friend Requests */}
        {incoming.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {dict.incomingRequests} ({incoming.length})
            </h2>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
              {incoming.map((f) => (
                <div
                  key={f.id}
                  className="p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={f.other_user.avatar_url}
                      name={f.other_user.full_name}
                      size="md"
                      isOnline={f.other_user.is_online}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {f.other_user.full_name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        <span dir="ltr" className="inline-block">@{f.other_user.username}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() =>
                        runAction(f.id, () =>
                          api.updateFriendship(f.id, 'accepted')
                        )
                      }
                      className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Check className="w-4 h-4" />
                      <span>{dict.accept}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() =>
                        runAction(f.id, () =>
                          api.updateFriendship(f.id, 'declined')
                        )
                      }
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <X className="w-4 h-4" />
                      <span>{dict.decline}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Accepted Friends */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {dict.myFriends} ({accepted.length})
          </h2>
          {accepted.length === 0 ? (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500 dark:text-slate-400">
              {dict.noFriendsYet}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
              {accepted.map((f) => (
                <div
                  key={f.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={f.other_user.avatar_url}
                      name={f.other_user.full_name}
                      size="md"
                      isOnline={f.other_user.is_online}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {f.other_user.full_name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        <span dir="ltr" className="inline-block">@{f.other_user.username}</span>
                        <span aria-hidden="true"> · </span>
                        <span>
                          {f.other_user.is_online ? dict.online : dict.offline}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartDirectChat(f.other_user.id)}
                      className="min-h-[40px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{dict.messageFriend}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onStartDirectCall(f.other_user.id, 'audio')
                      }
                      aria-label={`${dict.audioCall} ${f.other_user.full_name}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onStartDirectCall(f.other_user.id, 'video')
                      }
                      aria-label={`${dict.videoCall} ${f.other_user.full_name}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() =>
                        runAction(f.id, () =>
                          api.updateFriendship(f.id, 'blocked')
                        )
                      }
                      aria-label={`${dict.blockUser} ${f.other_user.full_name}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 flex items-center justify-center"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() =>
                        runAction(f.id, () => api.deleteFriendship(f.id))
                      }
                      aria-label={`${dict.removeFriend} ${f.other_user.full_name}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Discover People */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {dict.discoverUsers}
          </h2>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
            {directory.map((u) => {
              const rel = relationByUserId.get(u.id);
              return (
                <div
                  key={u.id}
                  className="p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={u.avatar_url}
                      name={u.full_name}
                      size="md"
                      isOnline={u.is_online}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {u.full_name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        <span dir="ltr" className="inline-block">@{u.username}</span>
                        {u.bio ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{u.bio}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {!rel || rel.status === 'declined' ? (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() =>
                          runAction(u.id, () =>
                            api.sendFriendRequest(u.id, 'pending')
                          )
                        }
                        className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-emerald-700 hover:text-white hover:border-emerald-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>{dict.addFriend}</span>
                      </button>
                    ) : rel.status === 'pending' && rel.direction === 'outgoing' ? (
                      <button
                        type="button"
                        disabled={busyId === rel.id}
                        onClick={() =>
                          runAction(rel.id, () => api.deleteFriendship(rel.id))
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        {dict.cancelRequest}
                      </button>
                    ) : rel.status === 'accepted' ? (
                      <button
                        type="button"
                        onClick={() => onStartDirectChat(u.id)}
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap"
                      >
                        {dict.messageFriend}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {rel.status}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Outgoing & Blocked */}
        {(outgoing.length > 0 || blocked.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {outgoing.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {dict.outgoingRequests} ({outgoing.length})
                </h2>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
                  {outgoing.map((f) => (
                    <div
                      key={f.id}
                      className="p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          src={f.other_user.avatar_url}
                          name={f.other_user.full_name}
                          size="sm"
                        />
                        <span className="text-sm font-medium truncate">
                          {f.other_user.full_name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(f.id, () => api.deleteFriendship(f.id))
                        }
                        className="text-xs text-slate-500 hover:text-red-600 font-medium whitespace-nowrap"
                      >
                        {dict.cancelRequest}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {blocked.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {dict.blockedUsers} ({blocked.length})
                </h2>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
                  {blocked.map((f) => (
                    <div
                      key={f.id}
                      className="p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          src={f.other_user.avatar_url}
                          name={f.other_user.full_name}
                          size="sm"
                        />
                        <span className="text-sm font-medium truncate">
                          {f.other_user.full_name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(f.id, () => api.deleteFriendship(f.id))
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        {dict.unblockUser}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
