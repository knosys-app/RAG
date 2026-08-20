import { useCallback, useRef, useState } from "react";

export interface UseAutoScroll {
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
  readonly pinned: boolean;
  readonly scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Scrolls only while the user is pinned to the bottom of the transcript. */
  readonly scrollToBottomIfPinned: () => void;
}

const PIN_THRESHOLD_PX = 48;

export function useAutoScroll(): UseAutoScroll {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      PIN_THRESHOLD_PX;
    pinnedRef.current = nearBottom;
    setPinned(nearBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTo({ behavior, top: element.scrollHeight });
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  const scrollToBottomIfPinned = useCallback(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [scrollToBottom]);

  return { containerRef, onScroll, pinned, scrollToBottom, scrollToBottomIfPinned };
}
