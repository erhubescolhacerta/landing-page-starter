import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

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
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // 17 images from public/media
  const images = Array.from({ length: 17 }, (_, i) => `/media/img-${i + 1}.jpeg`);

  useGSAP(() => {
    if (!containerRef.current) return;

    // Text reveal animation (Optional text animation)
    gsap.fromTo(titleRef.current, 
      { y: 50, opacity: 0 }, 
      { y: 0, opacity: 1, duration: 1, ease: "power3.out", delay: 0.2 }
    );

    // Mobile-first scroll animation: spread out effect like a deck of cards
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: containerRef.current,
        start: "top top",
        end: "+=200%", // Scroll distance
        scrub: 1,
        pin: true,
      }
    });

    // The first image stays centered and slightly scales up
    const firstImage = imagesRef.current[0];
    if (firstImage) {
      tl.to(firstImage, { scale: 1.05, duration: 1 }, 0);
    }

    // The rest of the images fan out / translate out of the stack
    imagesRef.current.slice(1).forEach((img, i) => {
      if (!img) return;
      
      const yOffset = 50 + (i * 25); 
      const xOffset = i % 2 === 0 ? 15 + (i * 8) : -(15 + (i * 8)); 
      const rotation = i % 2 === 0 ? 4 + (i * 2) : -(4 + (i * 2));
      
      tl.to(img, {
        y: yOffset,
        x: xOffset,
        rotation: rotation,
        opacity: 1 - (i * 0.04),
        duration: 1,
        ease: "power2.out"
      }, 0);
    });
  }, { scope: containerRef });

  return (
    <div className="bg-[#fcf7f0] text-[#1c2121] overflow-hidden e2vc-font isolate relative min-h-screen">
      {/* Background Grid & Noise */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-50">
        <svg width="100%" height="100%" className="absolute inset-0">
          <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(28, 33, 33, 0.15)" strokeWidth="1"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div className="noise-overlay z-10 mix-blend-overlay"></div>

      <div 
        ref={containerRef}
        className="relative z-20 w-full h-screen flex flex-col items-center justify-center px-4 pt-16 sm:pt-24"
      >
        {/* Headline */}
        <div className="absolute top-10 md:top-20 z-50 text-center px-4 w-full max-w-5xl mx-auto pointer-events-none">
          <p className="mb-4 text-[0.775rem] uppercase tracking-[0.02em] font-normal text-[#1c2121]/50">
            Apenas referências não bastam
          </p>
          <h1 
            ref={titleRef}
            className="text-[clamp(2.8rem,6vw,5.6rem)] font-semibold tracking-[-0.01em] leading-[0.95] lowercase"
          >
            você precisa da <br className="hidden md:block" />
            <span className="text-[#3451f5]">
              Escola Certa
            </span>
          </h1>
        </div>

        {/* Image Stack */}
        <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-md aspect-[4/5] mx-auto mt-28 md:mt-40">
          {images.map((src, idx) => (
            <img
              key={idx}
              ref={el => {
                imagesRef.current[idx] = el;
              }}
              src={src}
              alt={`Galeria ${idx + 1}`}
              className="absolute top-0 left-0 w-full h-full object-cover rounded-2xl origin-bottom"
              style={{
                zIndex: images.length - idx, // First image is on top
                boxShadow: "0 25px 50px -12px rgba(28,33,33,0.3)",
                willChange: "transform, opacity"
              }}
            />
          ))}
        </div>
      </div>
      
      {/* Spacer to allow scrolling past the pinned section */}
      <div className="h-[200vh] bg-[#fcf7f0] relative z-10"></div>
    </div>
  );
}
