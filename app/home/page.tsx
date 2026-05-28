import { DartBoardLanding } from "@/components/marketing/DartBoardLanding";

export default function HomePage() {
  return (
    <>
      <div data-db-home-embedded="true">
        <DartBoardLanding />
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            [data-db-home-embedded="true"] [class*="blur-["] {
              filter: blur(72px) !important;
            }
            [data-db-home-embedded="true"] [class*="backdrop-blur"] {
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }
          `,
        }}
      />
    </>
  );
}
