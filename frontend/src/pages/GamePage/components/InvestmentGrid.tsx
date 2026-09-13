import React from "react";
import { HStack, VStack, Box, Badge, Icon } from "@chakra-ui/react";
import { FaGrinStars } from "react-icons/fa";
import CardItem from "./CardItem";
import { COMPANY_COLORS } from "../../../constants/game";

interface InvestmentGridProps {
  investments: Record<number, number>;
  tokens: number[];
  /** 卡牌尺寸(rem 基数),手机端可传小值压缩高度 */
  size?: number;
}

// 已打出的卡牌固定单行横向排列(nowrap、不限宽):
// 公司变多时向两侧延展而不是换行堆高,避免遮挡下方牌堆。
// size<=2 为极小模式(手机端 3 列网格),间距/角标等比缩小并贴在卡牌内,防止溢出压到邻格
export const InvestmentGrid: React.FC<InvestmentGridProps> = ({
  investments,
  tokens,
  size = 4,
}) => {
  const tiny = size <= 2;
  const badgeSize = tiny ? "0.65rem" : "0.875rem";
  return (
    <HStack spacing={tiny ? 0.5 : 1} wrap="nowrap" justify="center">
      {Object.entries(investments).map(([companyStr, count]) => {
        const company = parseInt(companyStr);
        if (count === 0) return null;
        const hasToken = tokens.includes(company);
        return (
          <VStack key={company} spacing={0} position="relative" flexShrink={0}>
            <CardItem company={company} size={size} />
            <Badge
              position="absolute"
              bottom={tiny ? "0" : "-1"}
              right={tiny ? "0" : "-1"}
              colorScheme="blackAlpha"
              variant="solid"
              fontSize={tiny ? "6px" : "8px"}
              w={badgeSize}
              h={badgeSize}
              borderRadius="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              {count}
            </Badge>
            {hasToken && (
              <Box
                position="absolute"
                top={tiny ? "0" : "-1"}
                right={tiny ? "0" : "-1"}
                zIndex={1}
                bg="white"
                borderRadius="full"
                borderWidth={1}
                borderColor="blackAlpha.500"
                boxShadow="sm"
                p={tiny ? 0.25 : 0.5}
                display="flex"
              >
                <Icon
                  as={FaGrinStars}
                  color={COMPANY_COLORS[company]}
                  boxSize={`${size * 0.25}rem`}
                />
              </Box>
            )}
          </VStack>
        );
      })}
    </HStack>
  );
};
