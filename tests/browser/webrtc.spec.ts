import { test, expect } from "@playwright/test";
import { MediaStreamTrack, RtpHeader, RtpPacket } from "werift";
import { createLocalPeer } from "../../server/media";

test("local WebRTC negotiates two independent Opus tracks with browser packet reception", async ({
  page,
}) => {
  await page.goto("/");
  const peer = createLocalPeer();
  const tracks = [
    new MediaStreamTrack({ kind: "audio", id: "member-one" }),
    new MediaStreamTrack({ kind: "audio", id: "member-two" }),
  ];
  for (const track of tracks)
    peer.addTransceiver(track, { direction: "sendonly" });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await peer.setLocalDescription(await peer.createOffer());
    expect(peer.localDescription!.sdp).toContain("127.0.0.1");
    const answer = await page.evaluate(async (sdp) => {
      const browserPeer = new RTCPeerConnection({ iceServers: [] });
      const scope = window as unknown as {
        testPeer: RTCPeerConnection;
        testTrackIds: string[];
      };
      scope.testPeer = browserPeer;
      scope.testTrackIds = [];
      browserPeer.ontrack = (event) => scope.testTrackIds.push(event.track.id);
      await browserPeer.setRemoteDescription({ type: "offer", sdp });
      await browserPeer.setLocalDescription(await browserPeer.createAnswer());
      if (browserPeer.iceGatheringState !== "complete")
        await new Promise<void>((resolve) =>
          browserPeer.addEventListener("icegatheringstatechange", () => {
            if (browserPeer.iceGatheringState === "complete") resolve();
          }),
        );
      return browserPeer.localDescription!.sdp;
    }, peer.localDescription!.sdp);
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    await expect
      .poll(() => peer.connectionState, { timeout: 10000 })
      .toBe("connected");
    let sequence = 0;
    timer = setInterval(() => {
      for (const [index, track] of tracks.entries())
        track.writeRtp(
          new RtpPacket(
            new RtpHeader({
              payloadType: 111,
              sequenceNumber: sequence & 65535,
              timestamp: (sequence * 960) >>> 0,
              ssrc: index + 1,
            }),
            Buffer.from([0xf8, 0xff, 0xfe]),
          ),
        );
      sequence++;
    }, 20);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const peer = (window as unknown as { testPeer: RTCPeerConnection })
            .testPeer;
          const stats = await peer.getStats();
          const received: number[] = [];
          stats.forEach((entry) => {
            if (entry.type === "inbound-rtp" && entry.kind === "audio")
              received.push(entry.packetsReceived);
          });
          return received.filter((count) => count > 5).length;
        }),
      )
      .toBe(2);
    expect(
      await page.evaluate(
        () =>
          new Set(
            (window as unknown as { testTrackIds: string[] }).testTrackIds,
          ).size,
      ),
    ).toBe(2);
  } finally {
    clearInterval(timer);
    tracks.forEach((track) => track.stop());
    await peer.close();
    await page.evaluate(() =>
      (window as unknown as { testPeer?: RTCPeerConnection }).testPeer?.close(),
    );
  }
});
