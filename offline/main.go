package main

import (
	"fmt"
	"math/rand"
	"sort"
)

// CompanyID : 5 to 10
type CompanyID int

const (
	MinPlayers = 3
	MaxPlayers = 7
)

var companySizes = map[CompanyID]int{
	5:  5,
	6:  6,
	7:  7,
	8:  8,
	9:  9,
	10: 10,
}

type Card = CompanyID

type Player struct {
	ID           int
	Hand         []Card
	Investments  map[CompanyID]int // company -> count
	Money        int               // in 1-unit tokens
	HasAntiTrust map[CompanyID]bool
}

type Game struct {
	Players     []*Player
	Market      []Card // face-up cards
	Deck        []Card // face-down deck
	HiddenCards []Card // 5 hidden at start
	RoundScores []int  // cumulative round points (+2, +1, -1)
	CurrentTurn int
	Round       int
}

func NewGame(numPlayers int) *Game {
	if numPlayers < MinPlayers || numPlayers > MaxPlayers {
		panic("invalid player count")
	}

	// Build full deck
	var deck []Card
	for company, count := range companySizes {
		for i := 0; i < count; i++ {
			deck = append(deck, company)
		}
	}
	//洗牌
	rand.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })

	// Hide 5 cards
	hidden := deck[:5]
	deck = deck[5:]

	//玩家初始化
	players := make([]*Player, numPlayers)
	for i := 0; i < numPlayers; i++ {
		p := &Player{
			ID:           i,
			Hand:         nil,
			Investments:  make(map[CompanyID]int),
			Money:        10,
			HasAntiTrust: make(map[CompanyID]bool),
		}
		players[i] = p
	}

	// Deal 3 cards to each
	for i := 0; i < 3; i++ {
		for _, p := range players {
			p.Hand = append(p.Hand, deck[0])
			deck = deck[1:]
		}
	}

	return &Game{
		Players:     players,
		Market:      nil,
		Deck:        deck,
		HiddenCards: hidden,
		RoundScores: make([]int, numPlayers),
		CurrentTurn: 0,
		Round:       1,
	}
}

// Simulate one full round
func (g *Game) PlayRound() {
	fmt.Printf("=== Round %d ===\n", g.Round)

	for {
		current := g.Players[g.CurrentTurn]
		g.takeTurn(current)

		// Check if deck is empty and current just played → end round
		if len(g.Deck) == 0 {
			// Auto-invest hand
			for _, c := range current.Hand {
				current.Investments[c]++
			}
			current.Hand = nil
			break
		}

		g.CurrentTurn = (g.CurrentTurn + 1) % len(g.Players)
	}

	// End-of-round scoring
	g.endRoundScoring()
	g.prepareNextRound()
	g.Round++
}

func (g *Game) takeTurn(p *Player) {
	// Step 1: Acquire a card
	card := g.acquireCard(p)

	// Add to hand temporarily
	p.Hand = append(p.Hand, card)

	// Step 2: Play a card (simplified: always invest if possible, else market)
	// In real game, this is strategic — here we simulate
	var played Card
	if len(p.Hand) > 0 {
		// Simple AI: prefer to invest unless holding anti-trust conflict
		candidate := p.Hand[0]
		if !p.HasAntiTrust[candidate] {
			// Invest
			p.Investments[candidate]++
			played = candidate
			p.Hand = p.Hand[1:]
			g.updateAntiTrust(candidate, p.ID)
		} else {
			// Must play to market (but not same as just acquired if from market)
			// Simplified: just play first non-anti-trust or any
			found := false
			for i, c := range p.Hand {
				if !p.HasAntiTrust[c] {
					played = c
					p.Hand = append(p.Hand[:i], p.Hand[i+1:]...)
					g.Market = append(g.Market, played)
					found = true
					break
				}
			}
			if !found {
				// Forced: play first (violates rule slightly for sim)
				played = p.Hand[0]
				p.Hand = p.Hand[1:]
				g.Market = append(g.Market, played)
			}
		}
	}

	fmt.Printf("Player %d played %d\n", p.ID, played)
}

func (g *Game) acquireCard(p *Player) Card {
	// Simplified strategy: if can take free from market (with money on it), do so
	// Otherwise, draw from deck if affordable

	// Try to take from market
	for i, c := range g.Market {
		if p.HasAntiTrust[c] {
			continue // cannot take
		}
		// Take it
		card := g.Market[i]
		// Remove from market
		g.Market = append(g.Market[:i], g.Market[i+1:]...)
		// Player gets any money on it (not modeled in detail here)
		return card
	}

	// Else draw from deck
	if len(g.Deck) == 0 {
		return 0 // shouldn't happen
	}

	// Pay 1 per market card
	cost := len(g.Market)
	if p.Money >= cost {
		p.Money -= cost
		card := g.Deck[0]
		g.Deck = g.Deck[1:]
		return card
	}

	// Cannot afford → should not happen in real game, but handle
	return g.Deck[0] // force draw
}

func (g *Game) updateAntiTrust(company CompanyID, playerID int) {
	// Find who has most investments in this company
	maxCount := 0
	var leaders []int
	for _, p := range g.Players {
		count := p.Investments[company]
		if count > maxCount {
			maxCount = count
			leaders = []int{p.ID}
		} else if count == maxCount && maxCount > 0 {
			leaders = append(leaders, p.ID)
		}
	}

	// Clear all anti-trust for this company
	for _, p := range g.Players {
		p.HasAntiTrust[company] = false
	}

	// If single leader, give marker
	if len(leaders) == 1 {
		g.Players[leaders[0]].HasAntiTrust[company] = true
	}
}

func (g *Game) endRoundScoring() {
	// Reset money for payout tracking (use temporary net worth)
	netWorth := make([]int, len(g.Players))
	for i := range netWorth {
		netWorth[i] = g.Players[i].Money
	}

	// For each company
	for company := range companySizes {
		// Get counts
		counts := make([]int, len(g.Players))
		for i, p := range g.Players {
			counts[i] = p.Investments[company]
		}

		maxCount := 0
		maxIndex := -1
		hasMultiple := false
		for i, c := range counts {
			if c > maxCount {
				maxCount = c
				maxIndex = i
				hasMultiple = false
			} else if c == maxCount && maxCount > 0 {
				hasMultiple = true
			}
		}

		if maxCount == 0 || hasMultiple {
			continue // no majority
		}

		majority := maxIndex
		for i, c := range counts {
			if i != majority && c > 0 {
				payment := c * 3
				netWorth[majority] += payment
				netWorth[i] -= payment
			}
		}
	}

	// Determine rankings by netWorth
	type Rank struct {
		PlayerID int
		Wealth   int
	}
	ranks := make([]Rank, len(g.Players))
	for i := range g.Players {
		ranks[i] = Rank{PlayerID: i, Wealth: netWorth[i]}
	}
	sort.Slice(ranks, func(i, j int) bool {
		if ranks[i].Wealth != ranks[j].Wealth {
			return ranks[i].Wealth > ranks[j].Wealth // descending
		}
		return ranks[i].PlayerID < ranks[j].PlayerID // tie-break by ID
	})

	// Award points
	numPlayers := len(g.Players)
	g.RoundScores[ranks[0].PlayerID] += 2
	if numPlayers > 2 {
		g.RoundScores[ranks[1].PlayerID] += 1
	}
	g.RoundScores[ranks[numPlayers-1].PlayerID] -= 1

	fmt.Println("Round Net Worth:", netWorth)
	fmt.Println("Round Scores Update:", g.RoundScores)
}

func (g *Game) prepareNextRound() {
	// Reset everything except RoundScores
	deck := g.buildFullDeck()
	rand.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
	g.HiddenCards = deck[:5]
	deck = deck[5:]

	for _, p := range g.Players {
		p.Hand = nil
		p.Investments = make(map[CompanyID]int)
		p.Money = 10
		p.HasAntiTrust = make(map[CompanyID]bool)
	}

	// Deal 3 cards
	for i := 0; i < 3; i++ {
		for _, p := range g.Players {
			p.Hand = append(p.Hand, deck[0])
			deck = deck[1:]
		}
	}

	g.Deck = deck
	g.Market = nil
	g.CurrentTurn = 0
}

func (g *Game) buildFullDeck() []Card {
	var deck []Card
	for company, count := range companySizes {
		for i := 0; i < count; i++ {
			deck = append(deck, company)
		}
	}
	return deck
}

func (g *Game) GetWinner() int {
	maxScore := -100
	winner := -1
	for i, s := range g.RoundScores {
		if s > maxScore {
			maxScore = s
			winner = i
		}
	}
	return winner
}

func main() {
	game := NewGame(7)
	game.PlayRound()
	game.PlayRound()
	fmt.Printf("Final Scores: %v\n", game.RoundScores)
	fmt.Printf("Winner: Player %d\n", game.GetWinner())
}
