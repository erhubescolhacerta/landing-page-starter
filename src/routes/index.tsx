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

  // 17 images from public/media
  const images = Array.from({ length: 17 }, (_, i) => `/media/img-${i + 1}.jpeg`);

  useGSAP(() => {
    if (!containerRef.current) return;

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
    tl.to(imagesRef.current[0], { scale: 1.05, duration: 1 }, 0);

    // The rest of the images fan out / translate out of the stack
    imagesRef.current.slice(1).forEach((img, i) => {
      if (!img) return;
      
      // Calculate a scattered spread for mobile
      // We want them to fan out like cards spreading out downwards and sideways
      const yOffset = 50 + (i * 25); 
      const xOffset = i % 2 === 0 ? 15 + (i * 8) : -(15 + (i * 8)); 
      const rotation = i % 2 === 0 ? 4 + (i * 2) : -(4 + (i * 2));
      
      tl.to(img, {
        y: yOffset,
        x: xOffset,
        rotation: rotation,
        opacity: 1 - (i * 0.04), // slightly fade out further back ones
        duration: 1,
        ease: "power2.out"
      }, 0);
    });
  }, { scope: containerRef });

  return (
    <div className="bg-[#0d0d0d] text-white overflow-hidden font-sans">
      <div 
        ref={containerRef}
        className="relative w-full h-screen flex flex-col items-center justify-center px-4 pt-16 sm:pt-24"
      >
        {/* Headline */}
        <div className="absolute top-10 md:top-20 z-50 text-center px-4 w-full max-w-4xl mx-auto pointer-events-none">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
            Não adianta apenas ter boas referencias, <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#31FE6A] to-[#E4FC53]">
              você precisa da Escola Certa
            </span>
          </h1>
        </div>

        {/* Image Stack */}
        <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-md aspect-[4/5] mx-auto mt-24 md:mt-32">
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
                boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)",
                willChange: "transform, opacity"
              }}
            />
          ))}
        </div>
      </div>
      
      {/* Spacer to allow scrolling past the pinned section */}
      <div className="h-[200vh] bg-gradient-to-b from-[#0d0d0d] to-[#1a1a1a]"></div>
    </div>
  );
}
