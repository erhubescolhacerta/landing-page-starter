import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export const Route = createFileRoute("/")({
  head: () => ({
    title: "Escolha Certa - A Escola Certa",
    meta: [
      { name: "description", content: "Não adianta apenas ter boas referencias, você precisa da Escola Certa" },
    ],
  }),
  component: Index,
});

export function Index() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const logoRef = useRef<HTMLDivElement>(null);
  const imagesContainerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  // 17 images from public/media, split into 3 columns
  const allImages = Array.from({ length: 17 }, (_, i) => `/media/img-${i + 1}.jpeg`);
  const col1 = [...allImages.slice(0, 6), ...allImages.slice(0, 6)]; // Double for marquee loop
  const col2 = [...allImages.slice(6, 12), ...allImages.slice(6, 12)];
  const col3 = [...allImages.slice(12, 17), allImages[0], ...allImages.slice(12, 17), allImages[0]];

  useGSAP(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline({ delay: 0.2 });

    // 1. Logo appears
    tl.fromTo(logoRef.current, 
      { opacity: 0, y: -20 }, 
      { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }
    );

    // 2. Images container fades in
    tl.fromTo(imagesContainerRef.current,
      { opacity: 0, scale: 0.95 },
      { opacity: 1, scale: 1, duration: 1.2, ease: "power2.out" },
      "-=0.4"
    );

    // 3. Text reveals
    tl.fromTo(textRef.current,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" },
      "-=0.6"
    );

    // 4. Circle draws around "Escola Certa"
    if (pathRef.current) {
      tl.to(pathRef.current, {
        strokeDashoffset: 0,
        duration: 1.2,
        ease: "power2.inOut"
      }, "+=0.3");
    }

  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="bg-[#fcf7f0] text-[#1c2121] overflow-hidden e2vc-font isolate relative min-h-screen flex flex-col">
      {/* Background Grid & Noise */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40">
        <svg width="100%" height="100%" className="absolute inset-0">
          <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(28, 33, 33, 0.15)" strokeWidth="1"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div className="noise-overlay z-10 mix-blend-overlay"></div>

      {/* 1. Logo Intro */}
      <div ref={logoRef} className="relative z-50 w-full p-6 flex justify-between items-center opacity-0">
        <div className="text-2xl font-bold tracking-tight lowercase">escolha<span className="text-[#3451f5]">.</span>certa</div>
        <div className="text-sm font-medium uppercase tracking-widest opacity-60">Manifesto</div>
      </div>

      {/* 2. Marquee Images (Background Conveyor Belt) */}
      <div 
        ref={imagesContainerRef}
        className="absolute inset-0 z-0 flex gap-4 md:gap-8 justify-center items-center opacity-0 overflow-hidden pointer-events-none"
        style={{ padding: '0 2vw' }}
      >
        {/* Fade Out Masks at top and bottom */}
        <div className="absolute inset-0 z-10 bg-gradient-to-b from-[#fcf7f0] via-transparent to-[#fcf7f0] pointer-events-none opacity-90" />
        <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#fcf7f0] via-transparent to-[#fcf7f0] pointer-events-none opacity-80 hidden md:block" />
        
        {/* Column 1 */}
        <div className="w-1/3 md:w-1/4 max-w-[300px] h-[150vh] overflow-hidden -mt-[20vh]">
          <div className="marquee-track">
            {col1.map((src, i) => (
              <img key={`c1-${i}`} src={src} className="w-full h-auto aspect-[3/4] object-cover rounded-xl shadow-lg mix-blend-multiply opacity-80" alt="" />
            ))}
          </div>
        </div>
        
        {/* Column 2 (reverse) */}
        <div className="w-1/3 md:w-1/4 max-w-[300px] h-[150vh] overflow-hidden mt-[10vh] hidden sm:block">
          <div className="marquee-track reverse fast">
            {col2.map((src, i) => (
              <img key={`c2-${i}`} src={src} className="w-full h-auto aspect-[3/4] object-cover rounded-xl shadow-lg mix-blend-multiply opacity-80" alt="" />
            ))}
          </div>
        </div>

        {/* Column 3 */}
        <div className="w-1/3 md:w-1/4 max-w-[300px] h-[150vh] overflow-hidden -mt-[10vh]">
          <div className="marquee-track">
            {col3.map((src, i) => (
              <img key={`c3-${i}`} src={src} className="w-full h-auto aspect-[3/4] object-cover rounded-xl shadow-lg mix-blend-multiply opacity-80" alt="" />
            ))}
          </div>
        </div>
      </div>

      {/* 3. Headline & Circle */}
      <div className="relative z-40 flex-1 flex flex-col items-center justify-center px-4 pointer-events-none">
        <div ref={textRef} className="text-center max-w-5xl opacity-0">
          <h1 className="text-[clamp(2.5rem,7vw,6.5rem)] font-semibold tracking-[-0.02em] leading-[1.05] lowercase text-[#1c2121]">
            não adianta apenas ter <br className="hidden md:block"/> 
            boas referências, <br/>
            você precisa da <br/>
            <span className="relative inline-block mt-4 md:mt-6">
              <span className="text-[#3451f5] relative z-10 font-bold px-6 py-2 block">escolha certa</span>
              {/* SVG Circle to draw around (Multi-loop pen scribble) */}
              <svg 
                className="absolute inset-0 w-full h-full z-0 overflow-visible scale-[1.15]" 
                viewBox="0 0 300 100" 
                preserveAspectRatio="none"
              >
                <path
                  ref={pathRef}
                  className="draw-circle"
                  d="M 150 90 
                     C 30 95, -10 60, 20 25 
                     C 50 -10, 260 -5, 285 30 
                     C 310 65, 270 95, 150 90 
                     C 40 85, 0 50, 30 20 
                     C 60 -10, 240 -15, 270 20 
                     C 300 55, 250 85, 150 95
                     C 60 105, 10 75, 25 45
                     C 40 15, 220 5, 260 40
                     C 300 75, 240 100, 150 85"
                  fill="none"
                  stroke="#3451f5"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </span>
          </h1>
        </div>
      </div>
      
    </div>
  );
}
