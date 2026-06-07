"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import type { ChainStep } from "@/lib/types";
import styles from "./VisualVocalChain.module.css";

interface VisualVocalChainProps {
  chain: ChainStep[];
}

interface NodeRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function VisualVocalChain({ chain }: VisualVocalChainProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodeRects, setNodeRects] = useState<Record<string, NodeRect>>({});
  const [paths, setPaths] = useState<{ id: string; d: string; delay: number; isAux?: boolean }[]>([]);

  const mainNodes = [
    { id: "input", label: "Input", action: "" },
    ...chain.map((step) => ({
      id: `step-${step.step}`,
      label: step.tool,
      action: step.action,
    })),
  ];

  const buses = [
    // Top Row
    { 
      id: "bus-reverb", 
      label: "Reverb Bus", 
      color: "#00e5ff", // Cyberpunk Cyan
      plugins: [
        { id: "bus-rev-1", label: "Pro-Q 3", action: "Low cut 200Hz" },
        { id: "bus-rev-2", label: "Valhalla", action: "1.4s decay" }
      ]
    },
    { 
      id: "bus-delay", 
      label: "Delay Bus", 
      color: "#ff00aa", // Deep Magenta
      plugins: [
        { id: "bus-delay-1", label: "EchoBoy", action: "1/8 note, 15%" },
        { id: "bus-delay-2", label: "Pro-Q 3", action: "Bandpass" }
      ]
    },
    { 
      id: "bus-master", 
      label: "Mastering Bus", 
      isMaster: true, // Inherits default --accent (e.g. Amber)
      plugins: [
        { id: "bus-master-1", label: "SSL Comp", action: "Bus glue" },
        { id: "bus-master-2", label: "Ozone", action: "Maxmizer limit" }
      ]
    },
    // Bottom Row
    { 
      id: "bus-doubler", 
      label: "Vocal Doubler", 
      color: "#9d00ff", // Deep Violet
      plugins: [
        { id: "bus-doubler-1", label: "MicroShift", action: "Wide vocal spread" }
      ]
    },
    { 
      id: "bus-eq", 
      label: "Air EQ", 
      color: "#39ff14", // Electric Green
      plugins: [
        { id: "bus-eq-1", label: "Maag EQ4", action: "Air band boost" }
      ]
    },
    { 
      id: "bus-comp", 
      label: "Parallel Comp", 
      color: "#ff003c", // Crimson

      plugins: [
        { id: "bus-comp-1", label: "1176 AE", action: "All buttons in" }
      ]
    }
  ];

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateRects = () => {
      if (!containerRef.current) return;
      const containerBounds = containerRef.current.getBoundingClientRect();
      const nodeElements = Array.from(
        containerRef.current.querySelectorAll("[data-node-id]")
      );

      const newRects: Record<string, NodeRect> = {};
      nodeElements.forEach((node) => {
        const rect = node.getBoundingClientRect();
        newRects[node.getAttribute("data-node-id")!] = {
          id: node.getAttribute("data-node-id")!,
          left: rect.left - containerBounds.left,
          top: rect.top - containerBounds.top,
          width: rect.width,
          height: rect.height,
        };
      });

      setNodeRects(newRects);
    };

    updateRects();

    const observer = new ResizeObserver(updateRects);
    observer.observe(containerRef.current);
    const nodeElements = containerRef.current.querySelectorAll("[data-node-id]");
    nodeElements.forEach((n) => observer.observe(n));

    const timer = setTimeout(updateRects, 100);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [chain]);

  // Time constants for the sequential node-by-node build
  const LINES_DELAY = 5.5; // 5.5s: wait for main chain and buses to slowly fade in

  useEffect(() => {
    const newPaths: { id: string; d: string; delay: number; isAux?: boolean }[] = [];

    const inputRect = nodeRects["input"];

    // source-to-input wire: appears with Input node (index 0)
    // Input node delay = SOURCE_DOT_DELAY + NODE_INTERVAL * 0 = 0.1s
    if (inputRect) {
      const sourceX = inputRect.left + inputRect.width / 2;
      const sourceY = inputRect.top - 40;
      const endX = inputRect.left + inputRect.width / 2;
      const endY = inputRect.top;

      newPaths.push({
        id: "source-to-input",
        d: `M ${sourceX} ${sourceY} L ${endX} ${endY}`,
        delay: LINES_DELAY,
      });
    }

    // Connect main nodes sequentially.
    // Wire[i] (node[i] → node[i+1]) starts when node[i+1] appears.
    // node[i] appears at: SOURCE_DOT_DELAY + (i+1) * NODE_INTERVAL
    for (let i = 0; i < mainNodes.length - 1; i++) {
      const nodeA = nodeRects[mainNodes[i].id];
      const nodeB = nodeRects[mainNodes[i + 1].id];

      if (nodeA && nodeB) {
        const isRightSide = i % 2 === 0;
        const startX = isRightSide ? nodeA.left + nodeA.width : nodeA.left;
        const startY = nodeA.top + nodeA.height / 2;
        const endX = isRightSide ? nodeB.left + nodeB.width : nodeB.left;
        const endY = nodeB.top + nodeB.height / 2;

        const offset = isRightSide ? 60 : -60;
        const cpX1 = startX + offset;
        const cpX2 = endX + offset;

        newPaths.push({
          id: `${nodeA.id}-to-${nodeB.id}`,
          d: `M ${startX} ${startY} C ${cpX1} ${startY}, ${cpX2} ${endY}, ${endX} ${endY}`,
          delay: LINES_DELAY,
        });
      }
    }

    // last main node → output
    const lastMain = nodeRects[mainNodes[mainNodes.length - 1].id];
    const outputNode = nodeRects["output"];

    if (lastMain && outputNode) {
      const startX = lastMain.left + lastMain.width / 2;
      const startY = lastMain.top + lastMain.height;
      const endX = outputNode.left + outputNode.width / 2;
      const endY = outputNode.top;

      const cp1X = startX;
      const cp1Y = startY + 40;
      const cp2X = endX;
      const cp2Y = endY - 40;

      newPaths.push({
        id: `main-to-output`,
        d: `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`,
        delay: LINES_DELAY,
      });
    }

    // Bus wires: (delays are now static LINES_DELAY)
    buses.forEach((bus, i) => {
      const busNode = nodeRects[bus.id];
      if (busNode && outputNode) {
        const topmostBus = Math.min(...buses.map(b => nodeRects[b.id]?.top ?? Infinity));
        const mainChainLeftmost = Math.min(
          ...mainNodes.map(n => nodeRects[n.id]?.left ?? Infinity),
          outputNode.left
        );
        const sortedBuses = [...buses].sort((a, b) => {
          const aRect = nodeRects[a.id];
          const bRect = nodeRects[b.id];
          const ax = aRect ? aRect.left + aRect.width / 2 : 0;
          const bx = bRect ? bRect.left + bRect.width / 2 : 0;
          return bx - ax;
        });
        const wireRank = sortedBuses.findIndex(b => b.id === bus.id);

        const startX = outputNode.left;
        const wireStartY = outputNode.top + (outputNode.height / 2) - 15 + (wireRank * 6);
        const endX = busNode.left + busNode.width / 2;
        const endY = busNode.top;

        const wireChannelX = mainChainLeftmost - 40 - (wireRank * 12);
        const wireArchY = topmostBus - 40 - (wireRank * 12);
        const r = 20;

        let d = `M ${startX} ${wireStartY} `;
        d += `L ${wireChannelX + r} ${wireStartY} `;
        d += `Q ${wireChannelX} ${wireStartY} ${wireChannelX} ${wireStartY - r} `;
        d += `L ${wireChannelX} ${wireArchY + r} `;
        d += `Q ${wireChannelX} ${wireArchY} ${wireChannelX - r} ${wireArchY} `;
        d += `L ${endX + r} ${wireArchY} `;
        d += `Q ${endX} ${wireArchY} ${endX} ${wireArchY + r} `;
        d += `L ${endX} ${endY}`;

        newPaths.push({
          id: `output-to-${bus.id}`,
          d,
          delay: LINES_DELAY,
          isAux: true,
        });

        // Plugin wires follow 80ms after their parent bus node
        bus.plugins.forEach((plugin, pIndex) => {
          if (pIndex === 0) {
            const pluginNode = nodeRects[plugin.id];
            if (pluginNode && busNode) {
              const pStartX = busNode.left + busNode.width / 2;
              const pStartY = busNode.top + busNode.height;
              const pEndX = pluginNode.left + pluginNode.width / 2;
              const pEndY = pluginNode.top;
              const pCp1Y = pStartY + 20;
              const pCp2Y = pEndY - 20;

              newPaths.push({
                id: `${bus.id}-to-${plugin.id}`,
                d: `M ${pStartX} ${pStartY} C ${pStartX} ${pCp1Y}, ${pEndX} ${pCp2Y}, ${pEndX} ${pEndY}`,
                delay: LINES_DELAY,
                isAux: true,
              });
            }
          } else {
            const prevPlugin = bus.plugins[pIndex - 1];
            const prevNode = nodeRects[prevPlugin.id];
            const pluginNode = nodeRects[plugin.id];
            if (prevNode && pluginNode) {
              const pStartX = prevNode.left + prevNode.width / 2;
              const pStartY = prevNode.top + prevNode.height;
              const pEndX = pluginNode.left + pluginNode.width / 2;
              const pEndY = pluginNode.top;
              const pCp1Y = pStartY + 20;
              const pCp2Y = pEndY - 20;

              newPaths.push({
                id: `${prevPlugin.id}-to-${plugin.id}`,
                d: `M ${pStartX} ${pStartY} C ${pStartX} ${pCp1Y}, ${pEndX} ${pCp2Y}, ${pEndX} ${pEndY}`,
                delay: LINES_DELAY,
                isAux: true,
              });
            }
          }
        });
      }
    });

    setPaths(newPaths);
  }, [nodeRects, chain]);

  return (
    <div className={styles.container} ref={containerRef}>
      <svg className={styles.svgLayer} width="100%" height="100%">
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            className={`${styles.glowingPath} ${path.isAux ? styles.auxWire : styles.mainWire}`}
            style={{
              animationDelay: `${path.delay}s`,
            }}
          />
        ))}
      </svg>

      {/* Main Chain Area (Top Right) */}
      <div className={styles.mainChainArea}>
        {/* Source Dot */}
        {nodeRects["input"] && (
          <div 
            className={styles.sourceDotWrapper} 
            style={{ 
              top: nodeRects["input"].top - 48,
              left: nodeRects["input"].left + nodeRects["input"].width / 2 - 4
            }}
          >
            <div className={styles.sourceDot} />
          </div>
        )}

        <div className={styles.mainChain}>
          {mainNodes.map((node, index) => {
            const nodeDelay = index * 0.3;
            const isRightSide = index % 2 === 0;
            return (
              <div
                key={node.id}
                className={styles.chainNodeContainer}
                data-node-id={node.id}
              >
                <div
                  className={styles.nodeWrapper}
                  style={{ animationDelay: `${nodeDelay}s` }}
                >
                  <div className={styles.node}>
                    <span className={styles.nodeLabel}>{node.label}</span>
                    {node.action && <span className={styles.nodeAction} title={node.action}>{node.action}</span>}
                    
                    {index === 0 && <div className={`${styles.connectionDot} ${styles.dotVertical} ${styles.dotTop}`} />}
                    {index > 0 && <div className={`${styles.connectionDot} ${styles.dotHorizontal} ${isRightSide ? styles.dotLeft : styles.dotRight}`} />}
                    
                    {index < mainNodes.length - 1 && <div className={`${styles.connectionDot} ${styles.dotHorizontal} ${isRightSide ? styles.dotRight : styles.dotLeft}`} />}
                    {index === mainNodes.length - 1 && <div className={`${styles.connectionDot} ${styles.dotVertical} ${styles.dotBottom}`} />}
                  </div>
                </div>
              </div>
            );
          })}
          
          <div className={styles.outputWrapper} data-node-id="output">
            <div 
              className={styles.nodeWrapper}
              style={{ animationDelay: `${mainNodes.length * 0.3}s` }}
            >
              <div className={styles.node}>
                <span className={styles.nodeLabel}>Output</span>
                <div className={`${styles.connectionDot} ${styles.dotVertical} ${styles.dotTop}`} />
                <div className={`${styles.connectionDot} ${styles.dotLeft}`} style={{ left: '-6px', top: '50%', transform: 'translateY(-50%)', height: '40px', borderRadius: '4px' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Buses Area (Grouped on the left, staggered for perfect line routing) */}
      <div className={styles.busesArea}>
        {/* Top Row */}
        <div className={styles.busRow}>
          {buses.slice(0, 3).map((bus, index) => {
            // Main chain fades slowly, start buses after 3.0s
            const busNodeDelay = 3.0 + index * 0.3;
            return (
              <div className={styles.busColumn} key={bus.id}>
                <div data-node-id={bus.id} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                  <div
                    className={`${styles.nodeWrapper} ${styles.busNodeWrapper}`}
                    style={{ animationDelay: `${busNodeDelay}s` }}
                  >
                    <div className={`${styles.node} ${bus.isMaster ? styles.masteringNode : ''}`}>
                      <span className={styles.nodeLabel}>{bus.label}</span>
                      <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotTop}`} />
                      <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotBottom}`} />
                    </div>
                  </div>
                </div>
                {bus.plugins.map((plugin, pIndex) => (
                  <div key={plugin.id} data-node-id={plugin.id} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <div
                      className={`${styles.nodeWrapper} ${styles.busNodeWrapper}`}
                      style={{ animationDelay: `${busNodeDelay + (pIndex + 1) * 0.3}s` }}
                    >
                      <div className={`${styles.node} ${bus.isMaster ? styles.masteringNode : ''}`}>
                        <span className={styles.nodeLabel}>{plugin.label}</span>
                        <span className={styles.nodeAction}>{plugin.action}</span>
                        <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotTop}`} />
                        {pIndex < bus.plugins.length - 1 && (
                          <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotBottom}`} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Bottom Row (Staggered to prevent line crossing) */}
        <div className={`${styles.busRow} ${styles.busRowStaggered}`}>
          {buses.slice(3, 6).map((bus, index) => {
            const busNodeDelay = 3.0 + (index + 3) * 0.3;
            return (
              <div className={styles.busColumn} key={bus.id}>
                <div data-node-id={bus.id} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                  <div
                    className={`${styles.nodeWrapper} ${styles.busNodeWrapper}`}
                    style={{ animationDelay: `${busNodeDelay}s` }}
                  >
                    <div className={`${styles.node} ${bus.isMaster ? styles.masteringNode : ''}`}>
                      <span className={styles.nodeLabel}>{bus.label}</span>
                      <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotTop}`} />
                      <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotBottom}`} />
                    </div>
                  </div>
                </div>
                {bus.plugins.map((plugin, pIndex) => (
                  <div key={plugin.id} data-node-id={plugin.id} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <div
                      className={`${styles.nodeWrapper} ${styles.busNodeWrapper}`}
                      style={{ animationDelay: `${busNodeDelay + (pIndex + 1) * 0.3}s` }}
                    >
                      <div className={`${styles.node} ${bus.isMaster ? styles.masteringNode : ''}`}>
                        <span className={styles.nodeLabel}>{plugin.label}</span>
                        <span className={styles.nodeAction}>{plugin.action}</span>
                        <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotTop}`} />
                        {pIndex < bus.plugins.length - 1 && (
                          <div className={`${styles.connectionDot} ${styles.auxConnectionDot} ${styles.dotVertical} ${styles.dotBottom}`} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
