import { describe, it, expect, beforeEach } from "vitest";

import { createPlaylist, buildFavoritesFirstOrder } from "../assets/js/playlist.js";

const sampleFiles = [
  { id: "gong" },
  { id: "pling" },
  { id: "buzz" },
  { id: "cheer" },
];

describe("buildFavoritesFirstOrder", () => {
  it("places all favorites first and keeps counts", () => {
    const favorites = new Set(["gong", "pling"]);
    const { order, favoriteCount, restCount } = buildFavoritesFirstOrder({
      files: sampleFiles,
      favorites,
      seed: 123,
    });

    expect(favoriteCount).toBe(2);
    expect(restCount).toBe(2);

    const favoriteSegment = new Set(order.slice(0, favoriteCount));
    const restSegment = new Set(order.slice(favoriteCount));

    expect(favoriteSegment).toEqual(new Set(["gong", "pling"]));
    expect(restSegment).toEqual(new Set(["buzz", "cheer"]));
  });

  it("ignores favorites that are not in the manifest", () => {
    const favorites = new Set(["not-real", "gong"]);
    const { order, favoriteCount } = buildFavoritesFirstOrder({
      files: sampleFiles,
      favorites,
      seed: 42,
    });

    const favoriteSegment = order.slice(0, favoriteCount);
    expect(favoriteSegment).toContain("gong");
    expect(favoriteSegment).not.toContain("pling");
    expect(favoriteCount).toBe(1);
  });

  it("falls back gracefully when no favorites exist", () => {
    const { order, favoriteCount, restCount } = buildFavoritesFirstOrder({
      files: sampleFiles,
      favorites: new Set(),
      seed: 999,
    });

    expect(favoriteCount).toBe(0);
    expect(restCount).toBe(sampleFiles.length);
    expect(new Set(order)).toEqual(new Set(sampleFiles.map((file) => file.id)));
  });
});

describe("createPlaylist.applyOrder", () => {
  let playlist;

  beforeEach(() => {
    playlist = createPlaylist();
    playlist.init(sampleFiles);
  });

  it("applies explicit order, dedups, and resets cursor", () => {
    playlist.next(); // move cursor forward to ensure it resets later
    const snapshot = playlist.applyOrder(["buzz", "gong", "buzz", "unknown"]);

    expect(snapshot.index).toBe(0);
    expect(snapshot.order[0]).toBe("buzz");
    expect(snapshot.order[1]).toBe("gong");
    expect(new Set(snapshot.order)).toEqual(new Set(sampleFiles.map((f) => f.id)));
  });

  it("keeps a valid permutation when no order is provided", () => {
    const snapshot = playlist.applyOrder();
    expect(snapshot.index).toBe(0);
    expect(snapshot.order.length).toBe(sampleFiles.length);
    expect(new Set(snapshot.order)).toEqual(new Set(sampleFiles.map((f) => f.id)));
  });
});
