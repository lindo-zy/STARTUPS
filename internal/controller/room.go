package controller

import (
	"STARTUPS/internal/service"

	"github.com/gin-gonic/gin"
)

type RoomController struct {
	roomService service.RoomService
}

func NewRoomHandler() *RoomController {
	return &RoomController{
		roomService: service.NewRoomService(),
	}
}

func (h *RoomController) Create(c *gin.Context) {
	return
}

func (h *RoomController) Join(c *gin.Context) {
	return
}

func (h *RoomController) Leave(c *gin.Context) {
	return
}

func (h *RoomController) Status(c *gin.Context) {
	return
}

func (h *RoomController) Start(c *gin.Context) {
	return
}

func (h *RoomController) Ready(c *gin.Context) {
	return
}
