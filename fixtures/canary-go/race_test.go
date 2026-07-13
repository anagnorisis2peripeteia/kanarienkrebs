package canary

import (
	"sync"
	"testing"
)

// validate-provider canary for kanarienkrebs' go-race lane.
// `go test -race` MUST flag the deliberate unsynchronized concurrent write
// (WARNING: DATA RACE, nonzero exit); plain `go test` (no detector) passes.
// The lane is proven live only if the detector flips pass -> race.
func TestDataRace(t *testing.T) {
	var x int
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x++ // unsynchronized read-modify-write => data race
		}()
	}
	wg.Wait()
	_ = x
}
