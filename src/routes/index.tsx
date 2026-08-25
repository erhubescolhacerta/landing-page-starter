import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { PenTool } from "lucide-react";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

export const Route = createFileRoute("/")({
  head: () => ({
    title: "Escolha Certa - A Escola Certa",
    meta: [
      { name: "description", content: "Não adianta apenas ter boas referencias, você precisa da Escolha Certa" },
    ],
  }),
  component: Index,
});

export function Index() {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroPinRef = useRef<HTMLDivElement>(null);
  
  const logoRef = useRef<HTMLDivElement>(null);
  const imagesContainerRef = useRef<HTMLDivElement>(null);
  
  const line1Ref = useRef<HTMLSpanElement>(null);
  const line2Ref = useRef<HTMLSpanElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const penRef = useRef<HTMLDivElement>(null);

  // 17 images from public/media, split into 3 columns
  const allImages = Array.from({ length: 17 }, (_, i) => `/media/img-${i + 1}.jpeg`);
  const col1 = [...allImages.slice(0, 6), ...allImages.slice(0, 6)];
  const col2 = [...allImages.slice(6, 12), ...allImages.slice(6, 12)];
  const col3 = [...allImages.slice(12, 17), allImages[0], ...allImages.slice(12, 17), allImages[0]];

  useGSAP(() => {
    if (!containerRef.current || !heroPinRef.current) return;

    // Intro timeline (On Load)
    const introTl = gsap.timeline({ delay: 0.2 });
    introTl.fromTo(logoRef.current, 
      { opacity: 0, y: -20 }, 
      { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }
    );
    introTl.fromTo(imagesContainerRef.current,
      { opacity: 0, scale: 0.95 },
      { opacity: 1, scale: 1, duration: 1.2, ease: "power2.out" },
      "-=0.4"
    );

    // Scroll timeline (On Scroll)
    const scrollTl = gsap.timeline({
      scrollTrigger: {
        trigger: heroPinRef.current,
        start: "top top",
        end: "+=300%", // Long scroll area
        scrub: 1,
        pin: true,
      }
    });

    // Reveal Line 1 (Scroll 1)
    scrollTl.fromTo(line1Ref.current,
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 1, ease: "power2.out" }
    );

    // Reveal Line 2 (Scroll 2)
    scrollTl.fromTo(line2Ref.current,
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 1, ease: "power2.out" },
      "+=0.3"
    );

    // Draw the circle and pen
    if (pathRef.current && penRef.current) {
      const length = pathRef.current.getTotalLength();
      gsap.set(pathRef.current, { strokeDasharray: length, strokeDashoffset: length });
      
      // Show pen
      scrollTl.to(penRef.current, { opacity: 1, duration: 0.1 }, "+=0.2");
      
      // Draw circle and move pen simultaneously
      scrollTl.to(pathRef.current, {
        strokeDashoffset: 0,
        duration: 2,
        ease: "none"
      }, "drawCircle");

      scrollTl.to(penRef.current, {
        motionPath: {
          path: pathRef.current
        },
        duration: 2,
        ease: "none"
      }, "drawCircle");
      
      // Hide pen after drawing
      scrollTl.to(penRef.current, { opacity: 0, duration: 0.2 });
    }

  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="bg-[#fcf7f0] text-[#1c2121] overflow-x-clip e2vc-font isolate relative min-h-screen">
      {/* Background Grid & Noise */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40">
        <svg width="100%" height="100%" className="absolute inset-0">
          <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(28, 33, 33, 0.15)" strokeWidth="1"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div className="noise-overlay z-10 mix-blend-overlay fixed inset-0"></div>

      {/* Pinned Hero Section */}
      <div ref={heroPinRef} className="relative w-full h-screen block">
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
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-4 pointer-events-none">
          <div className="text-center max-w-5xl flex flex-col items-center">
            
            <span ref={line1Ref} className="opacity-0 text-[clamp(2.5rem,6vw,5.5rem)] font-semibold tracking-[-0.02em] leading-[1.1] lowercase text-[#1c2121]">
              não adianta só ter <br className="hidden md:block"/> boas referências,
            </span>

            <span ref={line2Ref} className="opacity-0 text-[clamp(2.5rem,6vw,5.5rem)] font-semibold tracking-[-0.02em] leading-[1.1] lowercase text-[#1c2121] mt-2 md:mt-4">
              você precisa da <br className="md:hidden" />
              <span className="relative inline-block ml-0 md:ml-4 mt-4 md:mt-0">
                <span className="text-[#3451f5] relative z-10 font-bold px-6 py-2 block">escolha certa</span>
                
                {/* SVG Circle and Pen */}
                <svg 
                  className="absolute inset-0 w-full h-full z-0 overflow-visible scale-[1.15]" 
                  viewBox="0 0 300 100" 
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="penGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#fff" />
                      <stop offset="50%" stopColor="#ccc" />
                      <stop offset="100%" stopColor="#888" />
                    </linearGradient>
                    <linearGradient id="blueGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#1a2980" />
                      <stop offset="100%" stopColor="#3451f5" />
                    </linearGradient>
                  </defs>

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
                  
                  {/* Embedded 3D Pen Icon */}
                  <g ref={penRef} style={{ opacity: 0 }}>
                    {/* The transform moves the pen so its absolute tip is at 0,0, pointing up-right */}
                    <g transform="translate(0, 0) scale(1.5)">
                      {/* Shadow */}
                      <path d="M0 0 L16 -16 L20 -12 L4 4 Z" fill="rgba(0,0,0,0.15)" transform="translate(2, 2)"/>
                      {/* Tip */}
                      <path d="M0 0 L4 -8 L8 -4 Z" fill="#e0e0e0" />
                      <path d="M0 0 L2 -4 L4 -2 Z" fill="#3451f5" />
                      {/* Body */}
                      <path d="M4 -8 L20 -24 L24 -20 L8 -4 Z" fill="url(#blueGrad)" />
                      {/* Highlight */}
                      <path d="M5 -7 L20 -22 L21 -21 L6 -5 Z" fill="rgba(255,255,255,0.4)" />
                      {/* Top */}
                      <path d="M20 -24 L24 -20 L26 -22 L22 -26 Z" fill="url(#penGrad)" />
                    </g>
                  </g>
                </svg>
              </span>
            </span>

          </div>
        </div>
      </div>
      
      {/* A spacer div for extra scroll area after pinning */}
      <div className="h-screen bg-[#fcf7f0] flex flex-col items-center justify-center relative z-20 px-6">
        <p className="text-xl md:text-3xl font-medium max-w-3xl text-center text-[#1c2121]/80">
          A escolha certa para o seu futuro começa aqui.
        </p>
      </div>

    </div>
  );
}
