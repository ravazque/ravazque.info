package core

import "testing"

// Ties are not below you: a whole kickoff at level 0 is above no one (the percentile counted them, "Above 100%").
func TestStandingsCountOnlyWhoIsStrictlyBelow(t *testing.T) {
	p := PromoStanding([]float64{0, 0, 0, 0}, 0).(*OMap)
	if p.I("below") != 0 || p.I("tied") != 3 || p.I("rank") != 1 {
		t.Fatalf("all tied: below %v tied %v rank %v", p.V("below"), p.V("tied"), p.V("rank"))
	}
	p = PromoStanding([]float64{1.5, 3, 3, 0.2, 7}, 3).(*OMap)
	if p.I("below") != 2 || p.I("tied") != 1 || p.I("rank") != 2 {
		t.Fatalf("mixed: below %v tied %v rank %v", p.V("below"), p.V("tied"), p.V("rank"))
	}
	m := MadridStanding([]float64{0, 0, 2, 5}, 0)
	if m.I("below") != 0 || m.I("rank") != 3 {
		t.Fatalf("madrid: below %v rank %v", m.V("below"), m.V("rank"))
	}
}
