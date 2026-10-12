/**
 * ImageModal Component (Floating Non-Modal Diagram Viewer)
 * Non-modal draggable floating window for exam question diagrams.
 * Features:
 * - Zero backdrop overlay: does not block background scrolling, clicks, or selection
 * - Draggable at 100% scale with Pointer Capture across viewport boundaries
 * - Outer window dynamically conforms to scaled image dimensions
 * - Compact toolbar without forcing artificial minimum width on small images
 * - Escape key dismiss, window resize re-clamping, and graceful error fallback
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.ImageModal = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, img, p } = DOM;
  const { useState, useEffect, useRef, useCallback } = React;

  function ImageModal({ isOpen, src, alt, onClose }) {
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 40, y: 60 });
    const [isDragging, setIsDragging] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

    const posRef = useRef(position);
    posRef.current = position;

    // Initial position calculation helper
    const calculateInitialPosition = useCallback((imgWidth = 400) => {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const isMobile = vw <= 768;
      const toolbarH = isMobile ? 84 : 44;
      const minY = toolbarH + 8;
      if (isMobile) {
        // Mobile: place near top-left with padding, leave room for top toolbar
        return { x: 10, y: Math.max(minY, 80) };
      }
      // Desktop: place on right side to avoid obscuring center question text
      const effectiveW = Math.max(imgWidth + 2, 340);
      const targetX = Math.max(20, vw - effectiveW - 60);
      return { x: targetX, y: Math.max(minY, 70) };
    }, []);

    // Reset state whenever modal opens or image src changes
    useEffect(() => {
      if (isOpen) {
        setScale(1);
        setHasError(false);
        setNaturalSize({ width: 0, height: 0 });
        setPosition(calculateInitialPosition(420));
      }
    }, [isOpen, src, calculateInitialPosition]);

    // Handle ESC key to close
    useEffect(() => {
      if (!isOpen) return;
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Calculate display dimensions conforming snugly to the image
    const getDisplayDimensions = useCallback(() => {
      if (naturalSize.width === 0 || naturalSize.height === 0) {
        return { width: 'auto', height: 'auto', numWidth: 0, numHeight: 0 };
      }
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

      // Initial desktop/mobile caps for comfortable reading without blocking the whole page
      const maxBaseW = vw <= 768 ? Math.max(240, vw - 40) : Math.min(vw * 0.55, 680);
      const maxBaseH = vw <= 768 ? Math.max(200, vh * 0.55) : Math.min(vh * 0.60, 520);

      let fitRatio = 1;
      if (naturalSize.width > maxBaseW || naturalSize.height > maxBaseH) {
        fitRatio = Math.min(maxBaseW / naturalSize.width, maxBaseH / naturalSize.height);
      }

      const baseW = Math.round(naturalSize.width * fitRatio);
      const baseH = Math.round(naturalSize.height * fitRatio);

      // Scaled dimensions
      const finalW = Math.round(baseW * scale);
      const finalH = Math.round(baseH * scale);

      return {
        width: `${finalW}px`,
        height: `${finalH}px`,
        numWidth: finalW,
        numHeight: finalH
      };
    }, [naturalSize, scale]);

    const displayDims = getDisplayDimensions();

    // Keep window in bounds on viewport resize so close button is always reachable
    useEffect(() => {
      if (!isOpen) return;
      const handleResize = () => {
        setPosition(prev => {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const isMobile = vw <= 768;
          const toolbarH = isMobile ? 84 : 44;
          const minY = toolbarH + 8;
          const effectiveW = Math.max((displayDims.numWidth || 300) + 2, isMobile ? Math.min(vw - 20, 340) : 340);
          const effectiveH = (displayDims.numHeight || 200) + 2;
          const minX = 8;
          const maxX = Math.max(minX, vw - effectiveW - 8);
          const maxY = Math.max(minY, vh - effectiveH - 12);
          return {
            x: Math.max(minX, Math.min(prev.x, maxX)),
            y: Math.max(minY, Math.min(prev.y, maxY))
          };
        });
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [isOpen, displayDims.numWidth, displayDims.numHeight]);

    // Keep window in bounds when zooming in expands dimensions
    useEffect(() => {
      if (!isOpen || displayDims.numWidth === 0) return;
      setPosition(prev => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const isMobile = vw <= 768;
        const toolbarH = isMobile ? 84 : 44;
        const minY = toolbarH + 8;
        const effectiveW = Math.max(displayDims.numWidth + 2, isMobile ? Math.min(vw - 20, 340) : 340);
        const effectiveH = displayDims.numHeight + 2;
        const minX = 8;
        const maxX = Math.max(minX, vw - effectiveW - 8);
        const maxY = Math.max(minY, vh - effectiveH - 12);
        return {
          x: Math.max(minX, Math.min(prev.x, maxX)),
          y: Math.max(minY, Math.min(prev.y, maxY))
        };
      });
    }, [scale, displayDims.numWidth, displayDims.numHeight, isOpen]);

    if (!isOpen || !src) return null;

    const handleZoomIn = (e) => {
      e.stopPropagation();
      setScale(prev => Math.min(Math.round((prev + 0.25) * 100) / 100, 3.0));
    };

    const handleZoomOut = (e) => {
      e.stopPropagation();
      setScale(prev => Math.max(Math.round((prev - 0.25) * 100) / 100, 0.5));
    };

    const handleReset = (e) => {
      e.stopPropagation();
      setScale(1);
    };

    const handleImageLoad = (e) => {
      const nw = e.target.naturalWidth || 400;
      const nh = e.target.naturalHeight || 300;
      setNaturalSize({ width: nw, height: nh });

      // If initial position was near right edge, re-adjust nicely to image width
      setPosition(prev => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const isMobile = vw <= 768;
        const toolbarH = isMobile ? 84 : 44;
        const minY = toolbarH + 8;
        if (isMobile) {
          return { x: Math.max(8, Math.min(prev.x, vw - 350)), y: Math.max(minY, prev.y) };
        }
        const baseW = Math.min(nw, Math.min(vw * 0.55, 680));
        const effectiveW = Math.max(baseW + 2, 340);
        const idealX = Math.max(20, vw - effectiveW - 60);
        return { x: Math.min(prev.x, idealX), y: Math.max(minY, prev.y) };
      });
    };

    const handleImageError = () => {
      setHasError(true);
    };

    // Immediate pointer drag handler with pointer capture and window tracking
    const handleDragPointerDown = (e) => {
      // Do not initiate drag when clicking buttons or interactive elements
      if (e.target.closest('button')) return;
      if (e.button !== undefined && e.button !== 0) return; // Left click or touch only

      const targetEl = e.currentTarget;
      const startX = e.clientX;
      const startY = e.clientY;
      const initPosX = posRef.current.x;
      const initPosY = posRef.current.y;
      const pointerId = e.pointerId;

      if (targetEl.setPointerCapture) {
        try {
          targetEl.setPointerCapture(pointerId);
        } catch (err) {}
      }

      setIsDragging(true);

      const onGlobalPointerMove = (moveEvt) => {
        const dx = moveEvt.clientX - startX;
        const dy = moveEvt.clientY - startY;

        let nextX = initPosX + dx;
        let nextY = initPosY + dy;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const isMobile = vw <= 768;
        const toolbarH = isMobile ? 84 : 44;
        const minY = toolbarH + 8;
        const effectiveW = Math.max((displayDims.numWidth || 300) + 2, isMobile ? Math.min(vw - 20, 340) : 340);
        const effectiveH = (displayDims.numHeight || 200) + 2;

        const minX = 8;
        const maxX = Math.max(minX, vw - effectiveW - 8);
        const maxY = Math.max(minY, vh - effectiveH - 12);

        nextX = Math.max(minX, Math.min(nextX, maxX));
        nextY = Math.max(minY, Math.min(nextY, maxY));

        setPosition({ x: nextX, y: nextY });
      };

      const onGlobalPointerUp = () => {
        window.removeEventListener('pointermove', onGlobalPointerMove);
        window.removeEventListener('pointerup', onGlobalPointerUp);
        window.removeEventListener('pointercancel', onGlobalPointerUp);

        if (targetEl.releasePointerCapture && pointerId !== undefined) {
          try {
            targetEl.releasePointerCapture(pointerId);
          } catch (err) {}
        }
        setIsDragging(false);
      };

      window.addEventListener('pointermove', onGlobalPointerMove);
      window.addEventListener('pointerup', onGlobalPointerUp);
      window.addEventListener('pointercancel', onGlobalPointerUp);
    };

    const windowStyle = {
      left: `${position.x}px`,
      top: `${position.y}px`
    };
    if (displayDims.numWidth > 0 && !hasError) {
      // Snug window fits image with only 2px border (1px left + 1px right, 1px top + 1px bottom)
      windowStyle.width = `${displayDims.numWidth + 2}px`;
      windowStyle.height = `${displayDims.numHeight + 2}px`;
    }

    return div({
      className: 'image-floating-viewer-root image-modal-backdrop',
      'aria-hidden': 'false'
    },
      div({
        className: 'image-floating-window image-modal-content',
        role: 'region',
        'aria-modal': 'false',
        'aria-label': '试题附图浮动查看器',
        style: windowStyle
      },
        // Floating window header & draggable toolbar
        div({
          className: 'floating-window-header modal-toolbar',
          onPointerDown: handleDragPointerDown,
          style: { cursor: isDragging ? 'grabbing' : 'grab' }
        },
          div({ className: 'header-drag-info' },
            span({ className: 'floating-window-grip' }, '⠿'),
            span({ className: 'floating-window-title' }, '附图查看'),
            span({ className: 'zoom-text floating-zoom-badge' }, `${Math.round(scale * 100)}%`)
          ),
          div({ className: 'zoom-buttons floating-toolbar-actions' },
            button({
              type: 'button',
              className: 'btn-modal-tool btn-float-tool',
              onClick: handleZoomIn,
              title: '放大 (+25%)'
            }, '🔍+ 放大'),
            button({
              type: 'button',
              className: 'btn-modal-tool btn-float-tool',
              onClick: handleZoomOut,
              title: '缩小 (-25%)'
            }, '🔍- 缩小'),
            button({
              type: 'button',
              className: 'btn-modal-tool btn-float-tool',
              onClick: handleReset,
              title: '还原 100%'
            }, '↺ 还原'),
            button({
              type: 'button',
              className: 'btn-modal-close btn-float-close',
              onClick: onClose,
              title: '关闭 (Esc)'
            }, '✕ 关闭')
          )
        ),

        // Floating image body / viewport
        div({
          className: 'floating-image-body modal-viewport',
          onPointerDown: handleDragPointerDown,
          style: { cursor: isDragging ? 'grabbing' : 'grab' }
        },
          hasError ? div({ className: 'floating-image-error-box' },
            span({ className: 'error-icon' }, '⚠️'),
            p({ className: 'error-msg' }, '图片加载失败或文件不存在'),
            button({
              type: 'button',
              className: 'btn-modal-close btn-float-close',
              onClick: onClose
            }, '关闭浮窗')
          ) : img({
            src: src,
            alt: alt || '试题附图',
            className: 'modal-zoomed-image floating-zoomed-img',
            draggable: false,
            onDragStart: (e) => e.preventDefault(),
            onLoad: handleImageLoad,
            onError: handleImageError,
            style: {
              width: displayDims.width,
              height: displayDims.height
            }
          })
        )
      )
    );
  }

  return ImageModal;
});
