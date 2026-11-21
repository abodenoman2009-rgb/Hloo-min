import type { CallType, SignalPayload } from '../types';
import { api } from './api';

export class WebRTCManager {
  private peers = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  constructor(
    private callId: string,
    private currentUserId: string,
    private callType: CallType,
    private sendWsSignal: (payload: SignalPayload) => void,
    private onRemoteStreamsChange: (streams: Map<string, MediaStream>) => void,
    private onPeerEnded: (peerId: string) => void
  ) {}

  async init(): Promise<{ stream: MediaStream | null; mediaWarning: boolean }> {
    try {
      const res = await api.getIceServers();
      if (res.iceServers?.length) {
        this.iceServers = res.iceServers;
      }
    } catch {
      // Keep STUN fallback
    }

    let mediaWarning = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video:
            this.callType === 'video'
              ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
              : false,
        });
      } catch {
        // Fallback to audio-only if camera fails, or null if headless/no hardware
        if (this.callType === 'video') {
          try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            mediaWarning = true;
          } catch {
            mediaWarning = true;
          }
        } else {
          mediaWarning = true;
        }
      }
    } else {
      mediaWarning = true;
    }

    return { stream: this.localStream, mediaWarning };
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    if (payload.callId !== this.callId) return;
    if (payload.from === this.currentUserId) return;
    if (payload.to && payload.to !== this.currentUserId) return;

    switch (payload.type) {
      case 'offer':
        if (payload.sdp) await this.handleOffer(payload.from, payload.sdp);
        break;
      case 'answer':
        if (payload.sdp) await this.handleAnswer(payload.from, payload.sdp);
        break;
      case 'ice-candidate':
        if (payload.candidate) await this.handleIceCandidate(payload.from, payload.candidate);
        break;
      case 'hangup':
        this.removePeer(payload.from);
        this.onPeerEnded(payload.from);
        break;
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
    });

    if (this.localStream) {
      const stream = this.localStream;
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.remoteStreams.set(peerId, remoteStream);
        this.onRemoteStreamsChange(new Map(this.remoteStreams));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWsSignal({
          type: 'ice-candidate',
          callId: this.callId,
          from: this.currentUserId,
          to: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = async () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          this.sendWsSignal({
            type: 'offer',
            callId: this.callId,
            from: this.currentUserId,
            to: peerId,
            sdp: offer,
          });
        } catch {
          // ignore if closed
        }
      }
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  async callPeer(peerId: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    const pc = this.createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendWsSignal({
      type: 'offer',
      callId: this.callId,
      from: this.currentUserId,
      to: peerId,
      sdp: offer,
    });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.createPeerConnection(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendWsSignal({
      type: 'answer',
      callId: this.callId,
      from: this.currentUserId,
      to: peerId,
      sdp: answer,
    });
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  toggleMute(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  toggleCamera(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  private removePeer(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.onRemoteStreamsChange(new Map(this.remoteStreams));
  }

  cleanup(): void {
    this.sendWsSignal({
      type: 'hangup',
      callId: this.callId,
      from: this.currentUserId,
    });
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteStreams.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}
