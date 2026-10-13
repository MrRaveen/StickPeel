export default function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/official_logo.png"
          alt="Loading"
          className="size-14 animate-pulse object-contain drop-shadow-md"
        />
        <span className="text-xs font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">
          Loading StickPeel Internal...
        </span>
      </div>
    </div>
  );
}
