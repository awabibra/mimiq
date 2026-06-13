"use client";

import React from "react";
import { motion } from "framer-motion";
import { Mic2, Activity, ShieldCheck, Link2 } from "lucide-react";

const signals = [
  { label: "Source", value: "Original take", icon: Mic2 },
  { label: "Target", value: "Project reference", icon: Link2 },
  { label: "Export", value: "Processed mix", icon: Activity },
];

const features = [
  {
    title: "Verify Before Trusting",
    desc: "Compare source and export before trusting a chain.",
    icon: Activity
  },
  {
    title: "Context Attached",
    desc: "Keep DAW, era, take, and reference context attached.",
    icon: Link2
  },
  {
    title: "No Fake Certainty",
    desc: "Separate measured changes from unknowns.",
    icon: ShieldCheck
  },
];

export function FeatureBlock() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center z-10" style={{ padding: "clamp(64px,10vh,120px) clamp(20px,5vw,64px)" }}>
      <div className="mx-auto grid w-full max-w-[1120px] gap-24 lg:grid-cols-2 lg:items-center">
        
        {/* Left: Text Story */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="flex flex-col gap-8"
        >
          <div className="flex flex-col gap-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#CBFF1E]">
              E-Val Path
            </span>
            <h2 className="text-[36px] font-bold tracking-[-0.015em] text-white">
              Measured First.
            </h2>
          </div>
          <p className="text-[16px] leading-[1.65] text-[#999] max-w-md">
            Stop guessing. We measure the delta between your original take and the processed export, comparing both to your reference.
          </p>

          <div className="mt-6 flex flex-col gap-8">
            {features.map((feature, i) => (
              <motion.div 
                key={feature.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex items-start gap-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center text-[#555]">
                  <feature.icon className="h-6 w-6" strokeWidth={1.5} />
                </div>
                <div className="pt-1">
                  <h3 className="text-[16px] font-semibold text-white">{feature.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-[#888]">{feature.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right: UI Preview / Proof Panel */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative w-full max-w-md justify-self-center rounded-[12px] border border-white/5 border-t-[#CBFF1E]/80 bg-[#111] p-6 shadow-2xl transition-transform hover:-translate-y-[2px] duration-240 lg:justify-self-end"
          style={{ boxShadow: "0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(203,255,30,0.2)" }}
        >
          <div className="mb-8 flex items-baseline justify-between gap-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.10em] text-[#555]">
              Studio Contract
            </span>
            <strong className="font-mono text-[11px] uppercase tracking-[0.10em] text-[#999]">
              No fake certainty.
            </strong>
          </div>

          <div className="flex flex-col gap-3">
            {signals.map((signal, index) => (
              <motion.div
                key={signal.label}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 + 0.3 }}
                className="flex min-h-[48px] items-center justify-between gap-4 rounded-[6px] border border-white/5 bg-white/[0.02] px-4"
              >
                <div className="flex items-center gap-3">
                  <signal.icon className="h-[16px] w-[16px] text-[#666]" strokeWidth={1.5} />
                  <span className="font-mono text-[12px] text-[#888]">{signal.label}</span>
                </div>
                <strong className="text-[13px] font-medium text-[#ccc]">{signal.value}</strong>
              </motion.div>
            ))}
          </div>

          {/* Audio Trace element (from original) */}
          <div className="relative mt-6 h-[34px] overflow-hidden rounded-[4px] bg-gradient-to-b from-transparent to-red-500/10 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
            <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,34,34,0.44)_0,rgba(255,34,34,0.44)_1px,transparent_1px,transparent_9px)]" />
            <div className="absolute bottom-[9px] left-0 right-0 h-[1px] bg-red-500/80 shadow-[0_0_18px_rgba(255,0,0,0.72)]" />
            <motion.div 
              animate={{ x: ["-110%", "310%"] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute bottom-1 top-1 w-[36%] bg-gradient-to-r from-transparent via-red-500/40 to-transparent"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
