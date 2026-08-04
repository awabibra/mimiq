import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/sandbox", destination: "/projects?resume=1&stage=main_chain", permanent: false },
      { source: "/mix-room", destination: "/projects?resume=1&stage=match_beat", permanent: false },
      { source: "/level-lab", destination: "/projects?resume=1&stage=match_beat", permanent: false },
      { source: "/vocal-diagnostics", destination: "/projects?resume=1&stage=prepare", permanent: false },
      { source: "/vault", destination: "/projects?resume=1&stage=match_beat&history=1", permanent: false },
    ];
  },
};

export default nextConfig;
