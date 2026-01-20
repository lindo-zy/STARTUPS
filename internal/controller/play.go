package controller

import "STARTUPS/internal/service"

type PlayController struct {
	playService service.PlayService
}

func NewPlayHandler() *PlayController {
	return &PlayController{
		playService: service.NewPlayService(),
	}
}
