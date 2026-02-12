import React, {useEffect, useRef, useState} from "react";
import {
  Box,
  Button,
  Input,
  Heading,
  VStack,
  HStack,
  Center,
  useColorModeValue,
  Text,
} from "@chakra-ui/react";
import { v4 as uuidv4 } from "uuid";
import { createRoom, joinRoom } from "../../services/api";
import { useNavigate } from "react-router-dom";
import {useSocket} from "../../context/SocketContext.tsx";

const GameLobby: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected, connect, disconnect, socket } = useSocket();

  useEffect(() => {
    if (!localStorage.getItem("playerId")) {
      const playerId = uuidv4();
      localStorage.setItem("playerId", playerId);
    }
  }, []);
  const bgColor = useColorModeValue("gray.50", "gray.900");
  const cardBg = useColorModeValue("white", "gray.800");
  const textColor = useColorModeValue("gray.800", "white");
  const [playerName, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const handleInputChange = (e) => {
    setNickname(e.target.value);
  };
  const handleRoomInputChange = (e) => {
    setRoomId(e.target.value);
  };
  return (
    <Box minH="100vh" p={4} bg={bgColor} w="full">
      <Center h="100vh">
        <Box
          bg={cardBg}
          borderRadius="xl"
          shadow="2xl"
          p={8}
          maxW="md"
          w="full"
          borderWidth="1px"
          borderColor={useColorModeValue("gray.200", "gray.700")}
          backdropFilter="auto"
          backdropBlur="10px"
          position="relative"
          overflow="hidden"
        >
          {/* 装饰元素 */}
          <Box
            position="absolute"
            top="-48px"
            right="-48px"
            w="160px"
            h="160px"
            bg="blue.500"
            borderRadius="full"
            opacity={0.1}
          />
          <Box
            position="absolute"
            bottom="-48px"
            left="-48px"
            w="160px"
            h="160px"
            bg="purple.500"
            borderRadius="full"
            opacity={0.1}
          />

          <Box position="relative" zIndex={10}>
            <Heading
              as="h1"
              size="2xl"
              textAlign="center"
              mb={8}
              fontWeight="bold"
              color={textColor}
            >
              游戏大厅
            </Heading>

            <VStack spacing={6} align="stretch">
              {/* 创建房间按钮 */}
              <Box>
                <Button
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  py={6}
                  fontSize="lg"
                  borderRadius="md"
                  _hover={{
                    bg: "blue.600",
                    transform: "scale(1.02)",
                  }}
                  _active={{ bg: "blue.700" }}
                  _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.5)" }}
                  transition="all 0.3s ease"
                  onClick={async () => {
                    const res = await createRoom({
                      host_player_name: playerName,
                    });
                    if (res) {
                      //创建Websocket
                      connect(res.room_id,playerName);
                      navigate(`/game`, {
                        state: { room_id: res.room_id, type: "create" },
                      });

                    }
                  }}
                >
                  创建房间
                </Button>
              </Box>
              <Input
                placeholder="用户昵称"
                size="lg"
                value={playerName}
                onChange={handleInputChange}
              />
              {/* 加入房间区域 */}
              <Box>
                <HStack spacing={3}>
                  <Input
                    placeholder="输入房间ID"
                    variant="outline"
                    size="lg"
                    focusBorderColor="blue.500"
                    borderRadius="md"
                    flex="1"
                    _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.3)" }}
                    bg={useColorModeValue("white", "gray.700")}
                    borderColor={useColorModeValue("gray.200", "gray.600")}
                    value={roomId}
                    onChange={handleRoomInputChange}
                  />
                  <Button
                    colorScheme="green"
                    size="lg"
                    py={6}
                    borderRadius="md"
                    _hover={{
                      bg: "green.600",
                      transform: "scale(1.05)",
                    }}
                    _active={{ bg: "green.700" }}
                    _focus={{ boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.5)" }}
                    transition="all 0.3s ease"
                    onClick={async () => {
                      // const playerId = localStorage.getItem("playerId");
                      // if (!playerId) {
                      //   return;
                      // }
                      // navigate(`/game`, {
                      //   state: { room_id: "123456" },
                      // });
                      // return;
                      const res = await joinRoom({
                        room_id: roomId,
                        player_name: playerName,
                      });
                      if (res) {
                        connect(res.room_id,playerName);
                        navigate(`/game`, {
                          state: { room_id: res.room_id },
                        });
                      }
                    }}
                  >
                    加入
                  </Button>
                </HStack>
              </Box>
            </VStack>
          </Box>
        </Box>
      </Center>

      {/* 页脚 */}
      <Box mt={8} textAlign="center">
        <Text fontSize="sm" color="gray.500">
          © 2026 游戏平台 | 享受游戏时光
        </Text>
      </Box>
    </Box>
  );
};

export default GameLobby;
