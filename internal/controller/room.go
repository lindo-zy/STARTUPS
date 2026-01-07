package controller

import (
	"STARTUPS/internal/response"
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

func (h *RoomController) CreateRoom(c *gin.Context) {
	response.Success(c, h.roomService.GetRoom())
	return
}

func (h *RoomController) JoinRoom(c *gin.Context) {
	return
}

func (h *RoomController) LeaveRoom(c *gin.Context) {
	return
}
func (h *RoomController) DeleteRoomList(c *gin.Context) {
	return
}
