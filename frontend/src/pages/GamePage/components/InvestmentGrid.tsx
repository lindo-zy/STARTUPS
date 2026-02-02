import React from "react";
import { HStack, VStack, Box, Badge } from "@chakra-ui/react";
import { COMPANY_COLORS } from "../../../constants/game";

interface InvestmentGridProps {
  investments: Record<number, number>;
  tokens: number[];
}

export const InvestmentGrid: React.FC<InvestmentGridProps> = ({
  investments,
  tokens,
}) => (
  <HStack spacing={1} wrap="wrap" justify="center" maxW="120px">
    {Object.entries(investments).map(([companyStr, count]) => {
      const company = parseInt(companyStr);
      if (count === 0) return null;
      const hasToken = tokens.includes(company);
      return (
        <VStack key={company} spacing={0} position="relative">
          <Box
            w="6"
            h="8"
            bg={COMPANY_COLORS[company]}
            borderRadius="sm"
            borderWidth={1}
            borderColor="whiteAlpha.500"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="xs"
            fontWeight="bold"
            color="white"
          >
            {company}
          </Box>
          <Badge
            position="absolute"
            bottom="-2"
            right="-2"
            colorScheme="blackAlpha"
            variant="solid"
            fontSize="9px"
            w="4"
            h="4"
            borderRadius="full"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            {count}
          </Badge>
          {hasToken && (
            <Box position="absolute" top="-2" right="-2" fontSize="xs">
              🛡️
            </Box>
          )}
        </VStack>
      );
    })}
  </HStack>
);
