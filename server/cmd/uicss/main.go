// Command uicss prints the CSS made from ui.json and colors.json (make site-sync writes it into the site's repository; make
// dev-live's Vite serves it as /ui.css). -colors FILE takes the colours from FILE instead (the golden test's frozen ones).
package main

import (
	"flag"
	"fmt"
	"os"

	"ravazque.info/server/core"
)

func main() {
	colorsFile := flag.String("colors", "", "a colors.json to use instead of the embedded one")
	flag.Parse()
	cfg, err := core.LoadUI()
	if *colorsFile != "" {
		var raw []byte
		if raw, err = os.ReadFile(*colorsFile); err == nil {
			cfg, err = core.LoadUIWith(raw)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "uicss:", err)
		os.Exit(1)
	}
	if errs := core.ValidateUI(cfg); len(errs) > 0 {
		for _, e := range errs {
			fmt.Fprintln(os.Stderr, "ui.json:", e)
		}
		os.Exit(1)
	}
	fmt.Print(core.CSSFromUI(cfg))
}
