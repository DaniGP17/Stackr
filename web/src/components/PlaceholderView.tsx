"use client";

export default function PlaceholderView({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="h-full p-4">
      <div className="card h-full flex flex-col items-center justify-center text-center px-6">
        <p className="label">{phase}</p>
        <h2 className="heading-lg mt-3">{title}</h2>
        <p className="text-[14px] text-white/45 mt-2 max-w-md leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
