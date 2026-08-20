/*
 * jsdom lacks several APIs that Radix UI primitives and the theme provider
 * rely on. These stubs run before every renderer test file.
 */
import { MotionGlobalConfig } from "motion/react";

// Animations resolve at their final keyframe instantly so tests that assert
// on element absence after AnimatePresence exits stay deterministic.
MotionGlobalConfig.skipAnimations = true;

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });

  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    value: () => false,
    writable: true,
  });
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    value: () => undefined,
    writable: true,
  });
  Object.defineProperty(Element.prototype, "releasePointerCapture", {
    value: () => undefined,
    writable: true,
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => undefined,
    writable: true,
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    value: () => undefined,
    writable: true,
  });

  class ResizeObserverStub {
    public disconnect(): void {}
    public observe(): void {}
    public unobserve(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    writable: true,
  });
}

export {};
