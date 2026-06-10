import { motion, useInView, useAnimation, Variants } from 'framer-motion';
import { useEffect, useRef, useState, ReactNode } from 'react';

// Reusable animation variants.
//
// The "hidden" variants intentionally keep `opacity: 1` and only animate
// transform offsets. Earlier variants set `opacity: 0` for the entry state,
// which left landing-page content invisible whenever the underlying scroll-
// reveal trigger (IntersectionObserver) or framer-motion's RAF loop didn't
// fire on first paint — the symptom users reported as "blank page".
// Animating transform-only keeps the slide-in flourish for visitors whose
// browsers run the animation, and degrades to plain visible text otherwise.
export const fadeInUp: Variants = {
  hidden: { opacity: 1, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

export const fadeInDown: Variants = {
  hidden: { opacity: 1, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

export const fadeInLeft: Variants = {
  hidden: { opacity: 1, x: -30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

export const fadeInRight: Variants = {
  hidden: { opacity: 1, x: 30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

export const scaleIn: Variants = {
  hidden: { opacity: 1, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1
    }
  }
};

export const staggerItem: Variants = {
  hidden: { opacity: 1, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.6, -0.05, 0.01, 0.99] }
  }
};

// Hover animations
export const hoverScale = {
  scale: 1.05,
  transition: { duration: 0.2, ease: "easeOut" }
};

export const hoverLift = {
  y: -4,
  transition: { duration: 0.2, ease: "easeOut" }
};

// Scroll-triggered animation component.
// Falls back to 'visible' after a short timeout if `useInView` never fires —
// IntersectionObserver can no-op when the page is loaded into a backgrounded
// tab (zero-area root) which left landing-page content stuck at opacity:0.
export function ScrollReveal({
  children,
  delay = 0,
  direction = 'up',
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  className?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const controls = useAnimation();

  useEffect(() => {
    if (isInView) {
      controls.start('visible');
      return;
    }
    const fallback = setTimeout(() => controls.start('visible'), 200);
    return () => clearTimeout(fallback);
  }, [isInView, controls]);

  const variants = {
    up: fadeInUp,
    down: fadeInDown,
    left: fadeInLeft,
    right: fadeInRight,
  }[direction];

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={controls}
      variants={variants}
      className={className}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

// Stagger children animation wrapper. Same fallback as ScrollReveal so the
// stagger reveal never strands its children at opacity:0 if useInView no-ops.
export function StaggerContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [fallbackVisible, setFallbackVisible] = useState(false);

  useEffect(() => {
    if (isInView) return;
    const t = setTimeout(() => setFallbackVisible(true), 200);
    return () => clearTimeout(t);
  }, [isInView]);

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView || fallbackVisible ? "visible" : "hidden"}
      variants={staggerContainer}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Stagger item component
export function StaggerItem({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

// Number counter animation
export function AnimatedNumber({ 
  value, 
  duration = 2,
  className = ''
}: { 
  value: number; 
  duration?: number;
  className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;

    let startTime: number | null = null;
    const startValue = 0;
    const endValue = value;

    const animate = (currentTime: number) => {
      if (startTime === null) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / (duration * 1000), 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = startValue + (endValue - startValue) * easeOutQuart;
      
      setDisplayValue(Math.floor(currentValue));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
      }
    };

    requestAnimationFrame(animate);
  }, [isInView, value, duration]);

  return (
    <span ref={ref} className={className}>
      {displayValue.toLocaleString()}
    </span>
  );
}

// Floating animation component
export function Floating({ 
  children, 
  intensity = 10,
  duration = 3,
  className = ''
}: { 
  children: ReactNode; 
  intensity?: number;
  duration?: number;
  className?: string;
}) {
  return (
    <motion.div
      animate={{
        y: [0, -intensity, 0],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Pulse glow animation
export function PulseGlow({ 
  children, 
  className = '',
  color = 'primary'
}: { 
  children: ReactNode; 
  className?: string;
  color?: 'primary' | 'accent' | 'success' | 'warning';
}) {
  return (
    <motion.div
      animate={{
        boxShadow: [
          `0 0 0px hsl(var(--${color}))`,
          `0 0 20px hsl(var(--${color}) / 0.5)`,
          `0 0 0px hsl(var(--${color}))`,
        ],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Page transition wrapper
export function PageTransition({ 
  children 
}: { 
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
